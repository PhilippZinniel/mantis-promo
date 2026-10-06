"""Procedural score + sound design for the Mantis film (no samples, no external audio).

Timing comes from the same cue sheet as the picture (src/cues.json), at 120 BPM (one beat = 0.5 s, one bar = 2 s).
One four-note rising motif (D-F-A-C -> D) recurs through the film; the harmony resolves at the logo lock-up. Instruments are
small physical-ish models (additive plucks and bells, pitch-swept toms, STFT-swept noise whooshes). Output: build/audio.wav
Run:  python tools/audio.py
"""
import json
import numpy as np
import scipy.signal as sg
import soundfile as sf

CUES = json.load(open('src/cues.json'))
K = CUES['t']
SR = 48000
DUR = float(CUES['duration'])
N = int(DUR * SR)
RNG = np.random.default_rng(2026)

# ------------------------------------------------------------------------------------------------ pitch
def hz(name):
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    pc = names[name[0]]
    i = 1
    if name[i] in '#b':
        pc += 1 if name[i] == '#' else -1; i += 1
    octv = int(name[i:])
    return 440.0 * 2 ** ((pc + 12 * (octv + 1) - 69) / 12)

# ------------------------------------------------------------------------------------------------ primitives
def n_(d): return int(round(d * SR))
def tt(d): return np.arange(n_(d)) / SR
def lp(x, fc, o=2): return sg.sosfilt(sg.butter(o, min(fc, SR * 0.45), 'low', fs=SR, output='sos'), x)
def hp(x, fc, o=2): return sg.sosfilt(sg.butter(o, fc, 'high', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return sg.sosfilt(sg.butter(o, [a, min(b, SR * 0.45)], 'band', fs=SR, output='sos'), x)

def adsr(d, a=0.005, dec=0.3, power=1.0):
    t = tt(d)
    e = np.exp(-t / dec) ** power
    att = np.minimum(t / max(a, 1e-4), 1.0)
    return e * att

def fade(x, a=0.0, r=0.0):
    x = x.copy()
    if a > 0:
        k = min(len(x), n_(a)); x[:k] *= np.linspace(0, 1, k) ** 1.5
    if r > 0:
        k = min(len(x), n_(r)); x[-k:] *= np.linspace(1, 0, k) ** 1.5
    return x

def swept_noise(d, fc, bw=1.0):
    """noise through a band whose centre follows fc(u), u in [0,1] (log-gaussian mask in the STFT domain)"""
    n = n_(d)
    noise = RNG.standard_normal(n + 4096)
    f, ts, Z = sg.stft(noise, SR, nperseg=2048, noverlap=1792)
    u = np.clip((ts - 1024 / SR) / d, 0, 1)
    c = np.maximum(fc(u), 30.0)
    mask = np.exp(-0.5 * (np.log2(np.maximum(f, 1.0)[:, None] / c[None, :]) / bw) ** 2)
    _, y = sg.istft(Z * mask, SR, nperseg=2048, noverlap=1792)
    y = y[1024:1024 + n]
    return y / (np.abs(y).max() + 1e-9)

def glide_sine(d, f0, f1, curve=1.0, amp=1.0):
    t = tt(d); u = (t / d) ** curve
    f = f0 * (f1 / f0) ** u
    return amp * np.sin(2 * np.pi * np.cumsum(f) / SR)

# ------------------------------------------------------------------------------------------------ instruments
def tom(f0=110, f1=48, d=0.7, tau=0.07, dec=0.22, click=0.35):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t / tau)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * adsr(d, 0.002, dec)
    ck = hp(RNG.standard_normal(len(t)), 1800) * np.exp(-t / 0.006) * click
    return y + ck

def sub(f=46, d=1.8, dec=0.75, drop=0.55):
    t = tt(d)
    ff = f * (1 + drop * np.exp(-t / 0.09))
    return np.sin(2 * np.pi * np.cumsum(ff) / SR) * adsr(d, 0.004, dec)

def hit_noise(d=0.5, lo=300, hi=7000, dec=0.12):
    return bp(RNG.standard_normal(n_(d)), lo, hi) * adsr(d, 0.001, dec)

def shing(d=1.0, rise=0.14):
    """blade: bright noise + inharmonic metallic partials + a fast upward ring"""
    t = tt(d)
    y = lp(hp(RNG.standard_normal(len(t)), 3200), 9000) * adsr(d, 0.002, 0.2) * 0.45
    for fr, a, dc in [(2940, .5, .5), (4210, .5, .42), (6730, .32, .3), (8200, .18, .2)]:
        y += a * np.sin(2 * np.pi * fr * t + RNG.uniform(0, 6.28)) * adsr(d, 0.002, dc)
    k = n_(rise)
    sw = glide_sine(rise, 1600, 7200, 1.3)
    y[:k] += 0.6 * sw * np.linspace(0, 1, k) ** 0.6
    return lp(y, 9500) * 0.6

def whoosh(d, f0, f1, bw=1.1, shape='bell', curve=1.0):
    y = swept_noise(d, lambda u: f0 * (f1 / f0) ** (u ** curve), bw)
    u = np.linspace(0, 1, len(y))
    if shape == 'bell': e = np.sin(np.pi * u) ** 1.6
    elif shape == 'rise': e = u ** 2.2
    elif shape == 'fall': e = (1 - u) ** 1.8 * np.minimum(u / 0.04, 1)
    else: e = np.ones_like(u)
    return y * e

def riser(d, f0=200, f1=7000):
    y = whoosh(d, f0, f1, 1.3, 'rise', 1.4)
    t = tt(d)
    s = glide_sine(d, f0 * 0.6, f1 * 0.22, 1.5) * (np.linspace(0, 1, len(t)) ** 2.2) * 0.35
    trem = 0.75 + 0.25 * np.sin(2 * np.pi * np.cumsum(4 + 22 * (t / d) ** 2) / SR)
    return (y * 0.9 + s) * trem

def pluck(f, d=1.6, bright=0.55):
    """guzheng/harp-ish: additive partials with faster decay up the series, tiny pitch settle, string click"""
    t = tt(d)
    bend = 1 + 0.004 * np.exp(-t / 0.05)
    y = np.zeros_like(t)
    for k in range(1, 13):
        if f * k > 12000: break
        a = (1.0 / k ** 1.15) * (bright ** (k - 1)) * (0.8 + 0.4 * RNG.random())
        dc = 1.15 / (k ** 0.55)
        y += a * np.sin(2 * np.pi * f * k * np.cumsum(bend) / SR * (1 + 0.0004 * k * k)) * np.exp(-t / dc)
    y *= np.minimum(t / 0.0025, 1)
    y += hp(RNG.standard_normal(len(t)), 2500) * np.exp(-t / 0.004) * 0.12
    return y / 1.6

def bell(f, d=3.0, amp=1.0):
    t = tt(d)
    y = np.zeros_like(t)
    for r, a, dc in [(1, 1.0, 2.4), (2.0, .55, 1.8), (2.76, .5, 1.3), (4.07, .28, 0.9), (5.4, .22, 0.6), (8.93, .1, 0.3)]:
        y += a * np.sin(2 * np.pi * f * r * t + RNG.uniform(0, 6.28)) * np.exp(-t / dc)
    return amp * y * np.minimum(t / 0.003, 1) / 2.2

def wood(f=1500, d=0.12):
    t = tt(d)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.022) + 0.5 * np.sin(2 * np.pi * f * 2.4 * t) * np.exp(-t / 0.014)
    y += hp(RNG.standard_normal(len(t)), 3000) * np.exp(-t / 0.003) * 0.4
    return y * 0.7

def pad(freqs, d, bright=1800, lfo=0.15):
    """slow detuned stack; returns stereo (L, R)"""
    t = tt(d)
    L = np.zeros_like(t); R = np.zeros_like(t)
    for f in freqs:
        for cents, side in [(-8, 0), (0, 0.5), (8, 1)]:
            fr = f * 2 ** (cents / 1200)
            s = sum(np.sin(2 * np.pi * fr * k * t + RNG.uniform(0, 6.28)) / k ** 1.3 for k in range(1, 9) if fr * k < 9000)
            L += s * (1 - side * 0.6); R += s * (0.4 + side * 0.6)
    mod = 0.85 + 0.15 * np.sin(2 * np.pi * lfo * t + RNG.uniform(0, 6.28))
    L, R = lp(L, bright) * mod / (len(freqs) * 3), lp(R, bright) * mod / (len(freqs) * 3)
    return fade(L, min(0.5, d * 0.3), min(0.7, d * 0.4)), fade(R, min(0.5, d * 0.3), min(0.7, d * 0.4))

def make_ir(d=2.8):
    n = n_(d); t = np.arange(n) / SR
    out = []
    for _ in range(2):
        x = RNG.standard_normal(n)
        y = lp(x, 3200) * np.exp(-t / 0.85) + hp(x, 3200) * np.exp(-t / 0.28) * 0.5
        y = lp(y, 9000)
        y[: n_(0.018)] = 0
        out.append(y * np.minimum(t / 0.01, 1))
    ir = np.array(out)
    return ir / np.sqrt((ir ** 2).sum(1, keepdims=True)).mean() * 0.9

# ------------------------------------------------------------------------------------------------ mixer
class Mix:
    def __init__(self):
        self.buses = {k: np.zeros((2, N)) for k in ['drums', 'bass', 'music', 'pad', 'fx']}
        self.send = np.zeros((2, N))
        self.duck = np.ones(N)
        self.gate = np.ones(N)          # applied to drums/bass/music/pad (not fx): deliberate dropouts before the big hits

    def put(self, bus, sig, t, g=1.0, pan=0.0, rev=0.0):
        if isinstance(sig, tuple):
            l, r = sig; sigs = (l * g, r * g)
        else:
            a = (pan + 1) * np.pi / 4
            sigs = (sig * g * np.cos(a), sig * g * np.sin(a))
        i = n_(t)
        for ch in (0, 1):
            s = sigs[ch]
            e = min(N, i + len(s))
            if e <= i or i >= N: continue
            seg = s[: e - i]
            self.buses[bus][ch, i:e] += seg
            if rev > 0: self.send[ch, i:e] += seg * rev

    def ducker(self, t, depth=0.5, rel=0.35, att=0.01):
        i = n_(t); tt_ = np.arange(N - i) / SR
        env = 1 - depth * (np.minimum(tt_ / att, 1) * np.exp(-tt_ / rel))
        self.duck[i:] *= env

    def drop(self, t0, t1, depth=1.0, ramp=0.03):
        """dropout window: musical buses fall to (1-depth) between t0 and t1 with short ramps"""
        i0, i1 = n_(t0), min(N, n_(t1)); r = n_(ramp)
        env = np.ones(N)
        env[i0:i1] = 1 - depth
        env[max(0, i0 - r):i0] = np.linspace(1, 1 - depth, i0 - max(0, i0 - r))
        self.gate *= env

M = Mix()

# ------------------------------------------------------------------------------------------------ harmony
BEAT = 0.5
def T(name, off=0.0): return K[name] + off
CHORDS = {   # name: (pad voicing, bass root, arpeggio notes low->high)
    'Dm': (['D3', 'A3', 'F4'], 'D2', ['D4', 'F4', 'A4', 'C5']),
    'Bb': (['Bb2', 'F3', 'D4'], 'Bb1', ['Bb3', 'D4', 'F4', 'A4']),
    'C': (['C3', 'G3', 'E4'], 'C2', ['C4', 'E4', 'G4', 'D5']),
    'Gm': (['G2', 'D3', 'Bb3'], 'G1', ['G3', 'Bb3', 'D4', 'F4']),
    'A': (['A2', 'E3', 'C#4'], 'A1', ['A3', 'C#4', 'E4', 'G4']),
    'D': (['D3', 'A3', 'F#4'], 'D2', ['D4', 'F#4', 'A4', 'C#5']),
    'Dsus': (['D3', 'A3', 'G4'], 'D2', ['D4', 'G4', 'A4', 'D5']),
    'G': (['G2', 'D3', 'B3', 'A4'], 'G1', ['G3', 'B3', 'D4', 'A4']),
}
PROG = [(0, 'Dm'), (T('descend', 0.2), 'Bb'), (T('titleRead'), 'Dm'), (T('titleEnd', -1.0), 'Bb'), (T('glossHave', -0.3), 'A'), (T('strike'), 'D'),
        (T('morphCaption', 0.5), 'G'), (T('toAnswer', -0.9), 'Bb'), (T('andMore', 0.2), 'C'), (T('s5Pull'), 'Gm'), (T('words', 0.5), 'Dm'), (T('stays', 0.3), 'Bb'),
        (T('wave', -0.2), 'C'), (T('wave', 1.8), 'A'), (T('paper'), 'D'), (T('lock'), 'Dsus'), (T('lock', 0.5), 'D'), (T('lock', 2.0), 'G'), (T('lock', 3.0), 'D')]
def chord_at(t):
    c = PROG[0][1]
    for t0, name in PROG:
        if t >= t0 - 1e-6: c = name
    return c

# ------------------------------------------------------------------------------------------------ voices
def pad_seg(t0, t1, g=0.16, bright=1500, extra=0.0):
    """sustained pad for the chord(s) between t0 and t1"""
    t = t0
    while t < t1 - 1e-6:
        nxt = min([x for x, _ in PROG if x > t + 1e-6] + [t1]); nxt = min(nxt, t1)
        name = chord_at(t)
        M.put('pad', pad([hz(x) for x in CHORDS[name][0]], (nxt - t) + 0.9, bright + 500 * extra, 0.1), t - 0.1, g)
        t = nxt

def arps(t0, t1, step=0.25, g=0.14, curve=None, pan=0.4):
    t = t0
    while t < t1 - 1e-6:
        name = chord_at(t); a = CHORDS[name][2]
        i = int(round(t / step))
        note = [a[0], a[1], a[2], a[3], a[2], a[1], a[0], a[2]][i % 8]
        gg = g * (curve(t) if curve else 1.0) * (1.0 if i % 4 == 0 else 0.72)
        M.put('music', pluck(hz(note), 1.1, 0.42), t, gg, pan=(-pan if i % 2 else pan), rev=0.4)
        t += step

def bass(t0, t1, g=0.3, every=1.0):
    t = t0
    while t < t1 - 1e-6:
        f = hz(CHORDS[chord_at(t)][1]); d = min(every * 0.95, 0.9); tt_ = tt(d)
        y = (np.sin(2 * np.pi * f * tt_) + 0.3 * np.sin(2 * np.pi * 2 * f * tt_)) * adsr(d, 0.006, d * 0.5)
        M.put('bass', y, t, g)
        t += every

def kick(t, g=0.6): M.put('drums', tom(90, 44, 0.45, 0.05, 0.16, 0.22), t, g)
def clap(t, g=0.3): M.put('drums', hit_noise(0.22, 700, 5500, 0.07), t, g, rev=0.2); M.put('drums', wood(900, 0.08), t, g * 0.4)
def hat(t, g=0.05): M.put('drums', lp(hp(RNG.standard_normal(n_(0.06)), 6500), 11000) * adsr(0.06, 0.001, 0.014), t, g, pan=0.3)

def motif(t0, notes=('D4', 'F4', 'A4', 'C5', 'D5'), step=0.5, g=0.3, color='bell', pan=0.2, rev=0.7, last=1.6):
    """the recurring four-note rising figure, landing long on the fifth note"""
    for i, nm in enumerate(notes):
        t = t0 + i * step; lastn = i == len(notes) - 1
        if color == 'bell': M.put('music', bell(hz(nm), 3.2 if lastn else 0.9, 1.0), t, g * (1.15 if lastn else 0.8), pan=pan, rev=rev)
        else: M.put('music', pluck(hz(nm), last if lastn else 1.0, 0.55), t, g * (1.1 if lastn else 0.85), pan=pan, rev=rev)

def big_hit(t, power=1.0, noise_g=0.4, blade_g=0.22):
    """one of the few full-weight impacts in the film"""
    M.put('drums', sub(46, 2.0, 0.8), t, 0.85 * power, rev=0.05)
    M.put('drums', tom(104, 42, 0.9, 0.09, 0.3), t, 0.8 * power, rev=0.1)
    M.put('fx', hit_noise(0.7, 200, 6500, 0.16), t, noise_g * power, rev=0.35)
    M.put('fx', shing(1.1), t, blade_g * power, rev=0.3)
    M.ducker(t, 0.5 * power, 0.5)

def knock(f, d=0.22):
    """a dull, slightly-wrong marimba knock (used for the isolated-word gloss)"""
    t = tt(d)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.07) + 0.4 * np.sin(2 * np.pi * f * 3.1 * t) * np.exp(-t / 0.03)
    return lp(y, 2500) * np.minimum(t / 0.002, 1)

# ================================================================================================ S1: unread (0 - slash)
wind = lp(whoosh(DUR * 0 + K['slash'] + 0.2, 220, 800, 1.0, 'bell'), 1800)
M.put('fx', fade(wind, 1.6), 0.0, 0.12, rev=0.3)                                          # night wind
_d = pad([hz('D2'), hz('A2'), hz('D3')], 5.2, 650, 0.08)
M.put('pad', (fade(_d[0], 2.4), fade(_d[1], 2.4)), 0.1, 0.30)                              # drone
M.put('music', bell(hz('A5'), 3.0, 0.5), 0.95, 0.07, pan=0.2, rev=0.7)                     # moon glint
M.put('music', pluck(hz('D3'), 2.4, 0.4), 1.8, 0.2, rev=0.5)
for i, nm in enumerate(['D4', 'F4', 'G4', 'A4', 'C5', 'A4', 'G4', 'F4']):                  # the caption is written: a first sketch of the motif
    t = T('captionIn', 0.15 + i * 0.0937)
    M.put('music', pluck(hz(nm), 1.0, 0.35), t, 0.08, pan=0.2, rev=0.5)
    M.put('music', wood(1400 + 80 * i, 0.1), t, 0.07, pan=-0.2 + 0.05 * i)
M.put('fx', riser(0.55, 400, 4200), T('slash', -0.6), 0.2, rev=0.2)
M.put('fx', glide_sine(0.2, 1500, 7200, 1.2, 1.0) * np.linspace(0, 1, n_(0.2)) ** 1.4, T('slash', -0.2), 0.12, rev=0.3)
M.drop(T('slash', -0.09), T('slash'), 0.85, 0.02)
big_hit(T('slash'), 0.95)                                                                  # impact 1: the slash
M.put('fx', whoosh(0.8, 5200, 700, 1.3, 'fall'), T('slash'), 0.4, rev=0.25)
for i, (dt, nm) in enumerate([(0.03, 'A5'), (0.09, 'D6'), (0.17, 'F5'), (0.26, 'C6'), (0.38, 'A5'), (0.5, 'D5')]):
    M.put('music', bell(hz(nm), 1.4, 0.4), T('slash', dt), 0.08, pan=(-1) ** i * 0.6, rev=0.7)

# ================================================================================================ S2: read (slash - title)
pad_seg(T('slash'), T('titleRead'), 0.12)
arps(4.0, T('pullback'), 0.5, 0.11, lambda t: 0.6 + 0.4 * (t - 4) / 3)              # sparse: eighths, not sixteenths
bass(4.0, T('pullback'), 0.2, 2.0)
for t in (4.0, 6.0): kick(t, 0.38)
for t, nm in [(T('readCaption'), 'G4'), (T('readQ'), 'A4'), (T('readA'), 'C5')]:           # reading marks: one soft note each
    M.put('music', wood(2100, 0.1), t, 0.2, rev=0.2)
    M.put('music', pluck(hz(nm), 1.2, 0.6), t, 0.22, rev=0.5)
M.put('fx', whoosh(0.7, 700, 2800, 0.9, 'bell'), T('descend'), 0.14, pan=0.3, rev=0.4)       # glide down the page
M.put('fx', glide_sine(0.7, 700, 2400, 1.0) * np.sin(np.pi * np.linspace(0, 1, n_(0.7))) ** 1.2, T('descend', -0.2), 0.05, rev=0.6)
M.put('fx', riser(0.9, 250, 3800), T('pullback'), 0.3, rev=0.2)

# ================================================================================================ S3: the whole page (title)
pad_seg(T('titleRead'), K['glossHave'], 0.17, 1700)
for t, nm, f0, g in [(T('titleRead'), 'D2', 120, 0.9), (T('titleThe'), 'F2', 135, 0.75), (T('titleWhole'), 'A2', 150, 0.8), (T('titlePage'), 'D3', 165, 0.95)]:
    M.put('drums', tom(f0 * 1.15, hz(nm) * 0.9, 0.7, 0.06, 0.26), t, 0.7 * g, rev=0.1)         # the title is the bass line: D F A D
    M.put('drums', sub(hz(nm), 1.2, 0.5, 0.2), t, 0.5 * g)
    M.put('fx', hit_noise(0.3, 400, 6000, 0.07), t, 0.18 * g, rev=0.25)
M.put('music', bell(hz('A4'), 2.8, 0.7), T('titleWhole'), 0.17, rev=0.7)
M.put('music', bell(hz('D5'), 3.2, 0.7), T('titlePage'), 0.24, rev=0.7)
M.ducker(T('titleRead'), 0.3, 0.5); M.ducker(T('titlePage'), 0.35, 0.5)
arps(T('titleWhole'), T('titleEnd'), 0.5, 0.1)
bass(T('titleRead'), T('titleEnd'), 0.28, 1.0)
for t in np.arange(T('titleRead'), T('titleEnd'), 1.0): kick(t + 0.5, 0.26)
M.put('fx', riser(1.5, 300, 4500), T('titleEnd') - 0.5, 0.3, rev=0.2)                    # tension while the whole title is held
M.put('fx', whoosh(0.9, 2400, 500, 1.0, 'fall'), T('titleEnd'), 0.2, rev=0.3)           # the dive

# ================================================================================================ S4a: the isolated word (gloss reel)
for t, f in [(K['glossHave'], hz('A3')), (K['glossOwn'], hz('Bb3')), (K['glossExist'], hz('G#3'))]:
    M.put('music', knock(f), t, 0.34, pan=-0.2 + 0.2 * (t - K['glossHave']), rev=0.2)    # dull, unsure knocks: nothing settles
M.put('fx', glide_sine(0.55, 500, 2400, 1.3, 1.0) * np.linspace(0, 1, n_(0.55)) ** 1.6, K['glossExist'] - 0.05, 0.06, rev=0.4)   # context travels the thread
M.put('fx', swept_noise(0.55, lambda u: 600 + 3600 * u, 0.9) * np.linspace(0, 1, n_(0.55)) ** 1.8, K['glossExist'] - 0.05, 0.16, rev=0.3)
M.drop(K['strike'] - 0.2, K['strike'], 0.95, 0.025)                                         # a beat of near-silence before the strike

# ================================================================================================ S4b: the strike, the rebuilt page
big_hit(K['strike'], 1.0, 0.45, 0.25)                                                       # impact 2: the strike (YES.)
for nm, g in [('D5', 0.38), ('A4', 0.32), ('F#5', 0.3), ('D6', 0.14)]:
    M.put('music', bell(hz(nm), 3.6, 1.0), K['strike'], g, rev=0.75)                       # D major: context found
M.put('fx', whoosh(0.6, 4800, 600, 1.2, 'fall'), K['strike'], 0.3, rev=0.2)
pad_seg(K['strike'], T('s5Pull'), 0.19, 1800, 0.5)
bass(K['strike'], K['s5Pull'], 0.3, 1.0)
arps(K['strike'] + 1.0, K['toAnswer'], 0.5, 0.12, lambda t: 0.8)
for t in np.arange(K['strike'] + 1.0, K['toAnswer'], 1.0): kick(t, 0.34)
motif(K['strike'] + 1.0, ('D5', 'F#5', 'A5', 'C#6', 'D6'), 0.5, 0.15, 'bell', 0.25)    # the motif, major: the English is read under it
M.put('fx', whoosh(0.6, 500, 3000, 0.9, 'bell'), K['strike'] + 0.15, 0.1, pan=-0.2, rev=0.4)    # ink-melt
M.put('fx', whoosh(0.6, 500, 3000, 0.9, 'bell'), K['strike'] + 0.5, 0.08, pan=0.3, rev=0.4)
M.put('fx', whoosh(0.8, 600, 2400, 0.9, 'bell'), K['toAnswer'], 0.1, rev=0.4)
M.put('music', pluck(hz('C5'), 1.4, 0.6), K['andMore'], 0.24, rev=0.5)
M.put('music', bell(hz('A5'), 2.6, 0.8), K['andMore'], 0.12, rev=0.7)

# ================================================================================================ S5: words change, the art stays (quiet)
M.put('fx', whoosh(0.9, 400, 2200, 1.0, 'bell'), K['s5Pull'] + 0.1, 0.16, rev=0.3)
pad_seg(K['s5Pull'], K['wallIn'], 0.13, 1300)
bass(K['s5Pull'] + 0.6, K['wallIn'], 0.18, 2.0)
M.put('drums', sub(44, 1.4, 0.7), K['words'], 0.4)
M.put('drums', tom(150, 75, 0.5, 0.05, 0.2), K['words'], 0.35, rev=0.1)
M.put('music', pluck(hz('A4'), 1.4, 0.5), K['words'], 0.18, rev=0.6)
M.put('music', pluck(hz('D4'), 1.6, 0.5), K['change'], 0.2, rev=0.6)
for dt in (0.63, 0.87):                                                                    # the text layer flickers back to the source language
    M.put('music', wood(2000 if dt < 0.7 else 1500, 0.1), K['change'] + dt, 0.2, pan=0.3, rev=0.2)
M.put('fx', swept_noise(0.5, lambda u: 1500 + 3500 * u, 0.9) * np.sin(np.pi * np.linspace(0, 1, n_(0.5))) ** 0.8, K['change'] + 0.4, 0.1, rev=0.2)   # brush stroke
M.put('fx', whoosh(0.4, 4200, 800, 1.2, 'fall'), K['wordsOut'], 0.14, rev=0.2)
M.put('music', pluck(hz('F4'), 1.2, 0.5), K['theArt'], 0.18, rev=0.6)
motif(K['stays'] - 0.0, ('D4', 'F4', 'A4', 'C5', 'D5'), 0.25, 0.16, 'pluck', 0.1, 0.7, 3.0)      # "the art stays": the motif, minor, then it holds
M.put('drums', sub(46, 1.6, 0.7), K['stays'] + 1.0, 0.42)
for nm, g in [('D5', 0.22), ('A4', 0.16), ('F#5', 0.15)]:
    M.put('music', bell(hz(nm), 3.4, 1.0), K['stays'] + 1.0, g, rev=0.8)
M.put('fx', glide_sine(1.6, 500, 2000, 1.0) * np.sin(np.pi * np.linspace(0, 1, n_(1.6))) ** 1.5, K['change'] + 1.0, 0.04, rev=0.7)   # the green trace
M.put('fx', whoosh(0.4, 4200, 800, 1.2, 'fall'), K['textOut'], 0.12, rev=0.2)

# ================================================================================================ S6: more worlds (the build)
pad_seg(K['wallIn'], K['paper'], 0.15, 1700, 1.0)
arps(K['wallIn'], K['wave'], 0.5, 0.1)
arps(K['wave'], K['paper'] - 0.35, 0.25, 0.15, lambda t: 0.7 + 0.5 * (t - K['wave']) / 3.2)
bass(K['wallIn'], K['wave'], 0.26, 1.0); bass(K['wave'], K['paper'] - 0.35, 0.42, 0.5)
for t in np.arange(K['wave'], K['paper'] - 0.4, 0.5): kick(t, 0.62 if (t - K['wave']) % 1.0 < 0.01 else 0.3)
for t in np.arange(K['wave'] + 0.5, K['paper'] - 0.4, 1.0): clap(t, 0.28)
for t in np.arange(K['wave'] + 0.25, K['paper'] - 0.4, 0.25): hat(t, 0.035 + 0.04 * (t - K['wave']) / 3.4)
M.put('fx', swept_noise(3.3, lambda u: 400 * (7000 / 400) ** (u ** 1.3), 1.2) * np.linspace(0.2, 1, n_(3.3)) ** 1.6, K['wave'], 0.28, rev=0.4)   # the wave
M.put('fx', glide_sine(3.3, 146.8, 1174.7, 1.0) * np.linspace(0.1, 1, n_(3.3)) ** 2, K['wave'], 0.1, rev=0.5)
for t, nm in [(K['wave'] - 0.2, 'D5'), (K['wave'] + 1.8, 'F5')]:
    M.put('drums', sub(46, 1.4, 0.7), t, 0.4); M.put('music', bell(hz(nm), 3.0, 0.8), t, 0.14, rev=0.7)
roll = np.concatenate([np.arange(K['paper'] - 1.5, K['paper'] - 0.5, 0.25), np.arange(K['paper'] - 0.5, K['paper'] - 0.12, 0.125)])
for i, t in enumerate(roll):
    M.put('drums', tom(170 + 90 * i / len(roll), 100, 0.18, 0.03, 0.06), t, 0.1 + 0.4 * i / len(roll), pan=(-1) ** i * 0.35)
M.put('fx', riser(1.9, 400, 7500), K['paper'] - 1.9, 0.4, rev=0.2)
M.put('fx', whoosh(0.7, 700, 6500, 1.5, 'rise', 1.0), K['wipe'] - 0.1, 0.4, rev=0.15)            # blade wipe
M.drop(K['paper'] - 0.17, K['paper'], 0.9, 0.025)                                          # silence on the beat before the paper opens

# ================================================================================================ S7: the logo
LK = K['lock']; T0 = LK - 1.98
big_hit(K['paper'], 1.0, 0.4, 0.24)                                                         # impact 3: the paper opens
M.put('music', bell(hz('D5'), 3.5, 1.0), K['paper'], 0.2, rev=0.8)
M.put('fx', whoosh(0.9, 3000, 400, 1.4, 'fall'), K['paper'], 0.35, rev=0.3)
pad_seg(K['paper'], LK, 0.16, 2000, 1.0)
M.put('fx', whoosh(0.7, 700, 4200, 0.8, 'bell'), T0 + 0.1, 0.22, pan=-0.4, rev=0.6)         # the ring crescents
M.put('fx', whoosh(0.5, 1000, 4800, 0.8, 'bell'), T0 + 0.24, 0.16, pan=0.5, rev=0.6)
for dt, g, nm in [(0.55, 0.26, 'F#3'), (0.67, 0.22, 'A3')]:                                  # the mantis' arms
    M.put('fx', shing(0.6, 0.07), T0 + dt, g * 0.55, rev=0.3); M.put('drums', tom(130, 70, 0.4, 0.05, 0.14), T0 + dt, 0.3)
    M.put('music', pluck(hz(nm), 1.4, 0.5), T0 + dt, g, rev=0.5)
M.put('fx', glide_sine(0.35, 400, 2800, 1.4) * np.linspace(0, 1, n_(0.35)) ** 1.5, T0 + 1.03, 0.12, rev=0.4)
M.put('drums', tom(140, 62, 0.6, 0.06, 0.2), T0 + 1.38, 0.6, rev=0.1); M.put('drums', sub(54, 1.2, 0.5), T0 + 1.38, 0.4)   # the head lands
M.put('music', bell(hz('A4'), 3.0, 1.0), T0 + 1.38, 0.26, rev=0.75)
for i, (dl, nm) in enumerate(zip([0, 0.04, 0.09, 0.14, 0.19, 0.24, 0.29], ['D4', 'F#4', 'A4', 'C#5', 'D5', 'F#5', 'A5'])):    # the wordmark rises: the motif at speed, in the resolved (major) form
    t = T0 + 1.15 + dl
    M.put('music', pluck(hz(nm), 1.0, 0.65), t, 0.26, pan=-0.5 + i / 6, rev=0.5)
M.put('fx', riser(0.5, 500, 7500), T0 + 1.5, 0.35, rev=0.15)                                # the M's leaf-slash flies in
M.put('fx', glide_sine(0.5, 200, 2600, 1.6) * np.linspace(0, 1, n_(0.5)) ** 2.2, T0 + 1.5, 0.15, rev=0.3)
M.drop(LK - 0.08, LK, 0.9, 0.02)
big_hit(LK, 1.1, 0.38, 0.28)                                                                # impact 4: the lock-up
for nm, g in [('D4', 0.42), ('A4', 0.36), ('G4', 0.3), ('D6', 0.22)]:                       # Dsus4: the logo arrives with one note unresolved...
    M.put('music', bell(hz(nm), 4.6, 1.0), LK, g, rev=0.8)
M.put('pad', pad([hz('D2'), hz('A2'), hz('D3'), hz('A3'), hz('G4')], 2.0, 3000, 0.09), LK, 0.3)
M.put('drums', sub(36.7, 3.2, 1.7, 0.25), LK, 0.45)
M.put('music', bell(hz('F#5'), 4.2, 1.0), LK + 0.5, 0.34, rev=0.85)                         # ...and resolves (G -> F#) half a bar later
M.put('music', bell(hz('A5'), 3.8, 1.0), LK + 0.5, 0.18, rev=0.85)
M.put('pad', pad([hz('D2'), hz('A2'), hz('D3'), hz('A3'), hz('F#4')], 4.6, 2800, 0.08), LK + 0.5, 0.3)
twink = ['D6', 'A5', 'F#6', 'A6', 'D6', 'F#5']
for i, nm in enumerate(twink):                                                             # the tagline
    M.put('music', bell(hz(nm), 1.8, 1.0), T0 + 2.4 + i * 0.1, 0.05, pan=np.sin(i * 2.1) * 0.7, rev=0.8)
M.put('fx', whoosh(0.7, 1500, 6000, 0.9, 'bell'), T0 + 2.6, 0.05, pan=0.2, rev=0.6)         # the glint across the wordmark
motif(LK + 1.5, ('D5', 'F#5', 'A5', 'D6'), 0.6, 0.12, 'bell', 0.15, 0.9)                    # the motif, resolved, one last time
M.put('pad', pad([hz('G2'), hz('D3'), hz('B3'), hz('A4')], 2.4, 2200, 0.08), LK + 2.0, 0.2)     # a gentle plagal "amen" (G -> D)
M.put('music', bell(hz('G5'), 3.0, 1.0), LK + 2.0, 0.08, pan=-0.2, rev=0.85)
M.put('pad', pad([hz('D2'), hz('A2'), hz('D3'), hz('F#4')], 2.6, 2000, 0.07), LK + 3.0, 0.22)
M.put('music', bell(hz('D5'), 3.0, 1.0), LK + 3.0, 0.07, pan=0.2, rev=0.9)

# ================================================================================================ mixdown
IR = make_ir()
dry = np.zeros((2, N))
for k, b in M.buses.items():
    d = b.copy()
    if k in ('pad', 'music'): d *= M.duck
    if k != 'fx': d *= M.gate
    dry += d
wet = np.stack([sg.fftconvolve(M.send[c], IR[c])[:N] for c in range(2)])
wet *= M.gate[None, :] ** 0.5                                                              # dropouts also thin the reverb tails
mix = dry + wet * 0.5
mix = np.tanh(mix * 0.9) / np.tanh(0.9)                                                    # gentle glue
sos_hp = sg.butter(2, 28, 'high', fs=SR, output='sos'); sos_lp = sg.butter(2, 14500, 'low', fs=SR, output='sos')      # no sub rumble, no fizz
mix = np.stack([sg.sosfilt(sos_lp, sg.sosfilt(sos_hp, mix[c])) for c in range(2)])
fo = n_(2.2); mix[:, -fo:] *= np.linspace(1, 0, fo) ** 1.6                                  # final fade
mix[:, :n_(0.02)] *= np.linspace(0, 1, n_(0.02))
mix = mix / np.abs(mix).max() * 0.82
sf.write('build/audio.wav', mix.T, SR, subtype='PCM_24')
print('audio written; peak %.1f dBFS; rms %.1f dBFS' % (20 * np.log10(np.abs(mix).max()), 20 * np.log10(np.sqrt((mix ** 2).mean()))))
