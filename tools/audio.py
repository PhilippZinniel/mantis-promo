"""Procedural score + sound design for the Mantis film (no samples, no external audio).

Every hit is pinned to the same timeline as the picture (120 BPM -> one beat = 0.5 s). Instruments are small
physical-ish models (additive plucks and bells, pitch-swept toms, STFT-swept noise whooshes). Output: build/audio.wav
Run:  python tools/audio.py
"""
import numpy as np
import scipy.signal as sg
import soundfile as sf

SR = 48000
DUR = 32.0
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
    y = hp(RNG.standard_normal(len(t)), 5200) * adsr(d, 0.002, 0.22) * 0.5
    for fr, a, dc in [(4210, .5, .5), (6730, .45, .42), (9120, .35, .3), (11400, .22, .22)]:
        y += a * np.sin(2 * np.pi * fr * t + RNG.uniform(0, 6.28)) * adsr(d, 0.002, dc)
    k = n_(rise)
    sw = glide_sine(rise, 2200, 9500, 1.3)
    y[:k] += 0.8 * sw * np.linspace(0, 1, k) ** 0.6
    return y * 0.6

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

M = Mix()

# ------------------------------------------------------------------------------------------------ score data
BEAT = 0.5
CHORDS = {  # bar start time -> (name, pad notes, bass root, arpeggio)
    'Dm': (['D3', 'A3', 'F4'], 'D2', ['D4', 'F4', 'A4', 'D5', 'A4', 'F4', 'D4', 'A3']),
    'Bb': (['Bb2', 'F3', 'D4'], 'Bb1', ['Bb3', 'D4', 'F4', 'Bb4', 'F4', 'D4', 'Bb3', 'F3']),
    'C': (['C3', 'G3', 'E4'], 'C2', ['C4', 'E4', 'G4', 'C5', 'G4', 'E4', 'C4', 'G3']),
    'Gm': (['G2', 'D3', 'Bb3'], 'G1', ['G3', 'Bb3', 'D4', 'G4', 'D4', 'Bb3', 'G3', 'D3']),
    'D': (['D3', 'A3', 'F#4'], 'D2', ['D4', 'F#4', 'A4', 'D5', 'A4', 'F#4', 'D4', 'A3']),
}
BARS = {1: 'Dm', 2: 'Dm', 3: 'Dm', 4: 'Dm', 5: 'Bb', 6: 'Gm', 7: 'Dm', 8: 'Bb', 9: 'C', 10: 'Gm', 11: 'Dm', 12: 'Bb', 13: 'C', 14: 'Dm', 15: 'D', 16: 'D'}
def bar_t(b): return (b - 1) * 2 * 1.0

def big_hit(t, power=1.0, shing_g=0.5, noise_g=0.55):
    M.put('drums', sub(46, 2.0, 0.8), t, 0.95 * power, rev=0.05)
    M.put('drums', tom(104, 42, 0.9, 0.09, 0.3), t, 0.9 * power, rev=0.1)
    M.put('fx', hit_noise(0.7, 200, 9000, 0.16), t, noise_g * power, rev=0.35)
    M.put('fx', shing(1.1), t, shing_g * power, rev=0.3)
    M.ducker(t, 0.55 * power, 0.5)

# ================================================================================================ S1 : unread (0 - 3.2)
M.put('fx', fade(whoosh(3.4, 260, 900, 1.0, 'bell'), 1.4), 0.0, 0.13, rev=0.3)                      # night wind
M.put('fx', whoosh(3.0, 1500, 3500, 0.8, 'bell'), 0.6, 0.04, pan=0.3, rev=0.4)
_d = pad([hz('D2'), hz('A2'), hz('D3')], 5.0, 700, 0.08)
M.put('pad', (fade(_d[0], 2.2), fade(_d[1], 2.2)), 0.1, 0.34)             # drone
M.put('music', bell(hz('A5'), 3.0, 0.5), 0.9, 0.12, pan=0.2, rev=0.7)                    # moon glint
M.put('music', pluck(hz('D3'), 2.4, 0.4), 1.8, 0.28, rev=0.5)
# caption: eight brush "writes", an ascending phrase
for i, nme in enumerate(['D4', 'F4', 'G4', 'A4', 'C5', 'A4', 'G4', 'F4']):
    t = 2.35 + i * 0.0937
    M.put('music', wood(1400 + 80 * i, 0.1), t, 0.14, pan=-0.2 + 0.05 * i)
    M.put('music', pluck(hz(nme), 1.0, 0.35), t, 0.08, pan=0.2, rev=0.5)
# hairline + cut
M.put('fx', riser(0.6, 400, 5000), 2.6, 0.35, rev=0.2)
M.put('fx', glide_sine(0.2, 1500, 9200, 1.2, 1.0) * np.linspace(0, 1, n_(0.2)) ** 1.4, 3.0, 0.22, rev=0.3)
big_hit(3.2, 1.0)
M.put('fx', whoosh(0.8, 7000, 700, 1.3, 'fall'), 3.2, 0.55, rev=0.25)
for i, (dt, nm) in enumerate([(0.03, 'A6'), (0.09, 'D7'), (0.17, 'F6'), (0.26, 'C7'), (0.38, 'A6'), (0.5, 'D6')]):
    M.put('music', bell(hz(nm), 1.4, 0.4), 3.2 + dt, 0.1, pan=(-1) ** i * 0.6, rev=0.7)

# ================================================================================================ pads, bass, arps per bar
def pad_bar(b, g=0.2, extra=0.0):
    nm = BARS[b]; notes = [hz(x) for x in CHORDS[nm][0]]
    d = 2.6
    M.put('pad', pad(notes, d, 1400 + 400 * extra, 0.12), bar_t(b) - 0.1, g)
for b in range(2, 14): pad_bar(b, g=0.14 + 0.01 * b)
for b in range(14, 17):
    M.put('pad', pad([hz(x) for x in CHORDS[BARS[b]][0]] + [hz('D4')], 2.8, 2600, 0.1), bar_t(b) - 0.1, 0.26)
# pad swell into the logo chord
M.put('pad', pad([hz('D3'), hz('A3'), hz('F#4'), hz('D5')], 4.4, 3800, 0.1), 27.5, 0.0)   # placeholder (replaced below)

def arps(t0, t1, step=0.25, g=0.2, vel_curve=None):
    t = t0
    while t < t1 - 1e-6:
        b = int(t // 2) + 1
        nm = BARS[b]; arp = CHORDS[nm][2]
        idx = int(round((t - bar_t(b)) / step)) % len(arp)
        gg = g * (vel_curve(t) if vel_curve else 1)
        M.put('music', pluck(hz(arp[idx]), 1.2, 0.42), t, gg * (1.0 if idx % 4 == 0 else 0.75), pan=(-0.4 if idx % 2 else 0.4), rev=0.4)
        t += step

def bass(t0, t1, g=0.4, every=0.5):
    t = t0
    while t < t1 - 1e-6:
        b = int(t // 2) + 1
        f = hz(CHORDS[BARS[b]][1])
        tt_ = tt(0.45)
        y = (np.sin(2 * np.pi * f * tt_) + 0.35 * np.sin(2 * np.pi * 2 * f * tt_)) * adsr(0.45, 0.004, 0.22)
        M.put('bass', y, t, g)
        t += every

def kick(t, g=0.7): M.put('drums', tom(90, 44, 0.45, 0.05, 0.16, 0.25), t, g)
def clap(t, g=0.35): M.put('drums', hit_noise(0.25, 700, 6500, 0.07), t, g, rev=0.2); M.put('drums', wood(900, 0.08), t, g * 0.5)
def hat(t, g=0.07): M.put('drums', hp(RNG.standard_normal(n_(0.06)), 7500) * adsr(0.06, 0.001, 0.014), t, g, pan=0.3)

# ================================================================================================ S2 : reading (3.2 - 8.0)
arps(4.0, 8.0, 0.25, 0.14, lambda t: 0.6 + 0.4 * (t - 4) / 4)
for t in (4.0, 6.0): kick(t, 0.45)
for t in np.arange(4.5, 8.0, 0.5): hat(t, 0.045)
bass(4.0, 8.0, 0.22, 1.0)
# reading marks
for t, nm in [(4.5, 'G4'), (5.0, 'A4'), (6.5, 'C5')]:
    M.put('music', wood(2100, 0.1), t, 0.3, rev=0.2)
    M.put('fx', shing(0.5, 0.06), t, 0.2, rev=0.3)
    M.put('music', pluck(hz(nm), 1.2, 0.6), t, 0.28, rev=0.5)
for a, b in [(4.55, 5.05), (5.1, 5.7), (6.55, 7.1)]:
    M.put('fx', whoosh(b - a, 2200, 6500, 0.8, 'bell'), a, 0.12, pan=0.2, rev=0.3)
# threads
for a, b in [(5.6, 6.3), (7.0, 7.9)]:
    M.put('fx', glide_sine(b - a, 700, 2600, 1.0) * np.sin(np.pi * np.linspace(0, 1, n_(b - a))) ** 1.2, a, 0.075, rev=0.6)
    M.put('fx', whoosh(b - a, 1200, 4200, 0.7, 'bell'), a, 0.09, rev=0.4)
# camera glides down the page to the answer bubble
M.put('fx', whoosh(0.8, 700, 3200, 0.9, 'bell'), 5.8, 0.2, pan=0.3, rev=0.4)
# pull-back into the title
M.put('fx', riser(0.95, 250, 4800), 7.05, 0.5, rev=0.2)

# ================================================================================================ S3 : context (8.0 - 12.0)
words = [(8.0, 'D2', 120, 1.0), (8.5, 'F2', 135, 0.8), (9.0, 'A2', 150, 0.85), (9.5, 'D3', 165, 1.0)]
for t, nm, f0, g in words:
    M.put('drums', tom(f0 * 1.15, hz(nm) * 0.9, 0.7, 0.06, 0.26), t, 0.85 * g, rev=0.1)
    M.put('drums', sub(hz(nm), 1.2, 0.5, 0.2), t, 0.55 * g)
    M.put('fx', hit_noise(0.3, 400, 8000, 0.07), t, 0.3 * g, rev=0.25)
    M.put('fx', whoosh(0.3, 6000, 1200, 1.2, 'fall'), t - 0.02, 0.22, rev=0.2)
M.put('music', bell(hz('A4'), 2.8, 0.7), 9.0, 0.22, rev=0.7)
M.put('music', bell(hz('D5'), 3.2, 0.7), 9.5, 0.3, rev=0.7)
M.ducker(8.0, 0.4, 0.5); M.ducker(9.5, 0.4, 0.5)
arps(8.0, 10.8, 0.25, 0.18)
bass(8.0, 10.8, 0.36, 0.5)
for t in np.arange(8.0, 10.8, 1.0): kick(t + 0.5, 0.35)
for t in np.arange(8.25, 10.8, 0.5): hat(t, 0.05)
# dive: tom roll + riser
roll = np.concatenate([np.arange(9.8, 10.3, 0.125), np.arange(10.3, 10.8, 0.0625)])
for i, t in enumerate(roll):
    M.put('drums', tom(150 + 40 * i / len(roll), 90, 0.18, 0.03, 0.07), t, 0.12 + 0.34 * i / len(roll), pan=(-1) ** i * 0.3)
M.put('fx', riser(1.0, 300, 7500), 9.8, 0.55, rev=0.2)
M.put('drums', sub(52, 1.2, 0.5), 10.8, 0.6)
M.put('drums', tom(100, 50, 0.5), 10.8, 0.6)
# gag: isolated gloss "HAVE." — a dull, slightly wrong knock
M.put('music', pluck(hz('D4'), 0.7, 0.2), 10.98, 0.3, pan=-0.3)
M.put('music', pluck(hz('Eb4'), 0.7, 0.2), 10.99, 0.26, pan=0.3)
for dt in (0.0, 0.07, 0.13): M.put('fx', hit_noise(0.05, 900, 3000, 0.02), 10.98 + dt, 0.22)
M.put('fx', shing(0.55, 0.09), 11.2, 0.5, rev=0.3)                                         # strike-through
M.put('music', wood(2600, 0.08), 11.42, 0.25, rev=0.4)
# YES. — warm resolution (D major)
for nm, g in [('D5', 0.5), ('A4', 0.4), ('F#5', 0.38), ('D6', 0.2)]:
    M.put('music', bell(hz(nm), 3.4, 1.0), 11.55, g, rev=0.75)
M.put('drums', sub(46, 1.4, 0.6), 11.55, 0.45)
M.put('pad', pad([hz('D3'), hz('A3'), hz('F#4')], 1.3, 2200, 0.1), 11.5, 0.2)
M.put('fx', riser(0.5, 600, 8000), 11.5, 0.3)

# ================================================================================================ S4 : transformation (12 - 17)
big_hit(12.0, 1.0, 0.55, 0.6)
M.put('fx', whoosh(0.5, 5200, 500, 1.2, 'fall'), 12.0, 0.45, rev=0.2)
arps(12.0, 17.0, 0.25, 0.24)
bass(12.0, 17.0, 0.5, 0.5)
for t in np.arange(12.5, 17.0, 1.0): kick(t - 0.5, 0.75); clap(t, 0.32)
for t in np.arange(12.25, 17.0, 0.5): hat(t, 0.075)
# ink-melt glissandi
for a, b, base in [(12.5, 13.75, 'D4'), (14.1, 14.95, 'F4')]:
    steps = ['D4', 'F4', 'G4', 'A4', 'C5', 'D5', 'F5', 'G5', 'A5', 'C6']
    k = int((b - a) / 0.0625)
    for i in range(k):
        nm = steps[min(i * len(steps) // k, len(steps) - 1)]
        M.put('music', pluck(hz(nm), 0.9, 0.5), a + i * 0.0625, 0.1 + 0.1 * i / k, pan=np.sin(i), rev=0.5)
    M.put('fx', whoosh(b - a, 500, 4200, 0.9, 'rise', 1.2), a, 0.2, rev=0.4)
M.put('music', bell(hz('A5'), 2.6, 0.8), 13.75, 0.34, rev=0.7); M.put('music', bell(hz('D6'), 2.6, 0.6), 13.75, 0.2, rev=0.7)
M.put('music', bell(hz('F5'), 2.6, 0.8), 14.95, 0.34, rev=0.7); M.put('music', bell(hz('C6'), 2.6, 0.6), 14.95, 0.2, rev=0.7)
M.put('music', pluck(hz('C5'), 1.4, 0.6), 15.0, 0.3, rev=0.5)
for a in (14.0, 14.95): M.put('fx', whoosh(0.45, 4500, 600, 1.2, 'fall'), a, 0.35, rev=0.2)
M.put('fx', whoosh(0.5, 4500, 600, 1.2, 'fall'), 12.0, 0.0)
M.put('fx', riser(1.0, 300, 3500), 16.0, 0.28, rev=0.3)

# ================================================================================================ S5 : the art stays (17 - 21)
M.put('fx', whoosh(1.0, 300, 3800, 1.0, 'rise', 1.3), 17.0, 0.4, rev=0.3)
M.put('drums', sub(44, 1.4, 0.7), 17.0, 0.6)
arps(17.0, 21.0, 0.5, 0.22)
bass(17.0, 21.0, 0.4, 1.0)
for t in np.arange(17.0, 21.0, 1.0): kick(t, 0.5)
for t, f0, g, nm in [(17.45, 150, 0.6, 'A4'), (17.65, 118, 0.75, 'D4'), (19.6, 150, 0.6, 'C5'), (19.8, 100, 1.0, 'D5')]:
    M.put('drums', tom(f0, f0 * 0.5, 0.5, 0.05, 0.2), t, g, rev=0.1)
    M.put('fx', shing(0.5, 0.05), t, 0.16 * g, rev=0.3)
    M.put('music', bell(hz(nm), 2.6, 0.8), t, 0.2 * g, rev=0.7)
M.put('drums', sub(46, 1.5, 0.7), 19.8, 0.5)
for a, b in [(18.05, 18.55), (20.2, 20.7)]:
    M.put('fx', swept_noise(b - a, lambda u: 1800 + 4800 * u, 0.9) * np.sin(np.pi * np.linspace(0, 1, n_(b - a))) ** 0.8, a, 0.2, rev=0.2)
for i, t in enumerate([18.28, 18.40, 18.52, 18.64]):
    M.put('music', wood(2200 if i % 2 == 0 else 1500, 0.1), t, 0.34, pan=0.4 * (-1) ** i, rev=0.2)
M.put('fx', glide_sine(1.6, 500, 2000, 1.0) * np.sin(np.pi * np.linspace(0, 1, n_(1.6))) ** 1.5, 18.6, 0.07, rev=0.7)
for a in (19.15, 20.95): M.put('fx', whoosh(0.4, 5000, 800, 1.2, 'fall'), a, 0.3, rev=0.2)

# ================================================================================================ S6 : more worlds (21 - 26)
M.put('fx', riser(1.1, 300, 5000), 20.9, 0.35, rev=0.3)
arps(21.0, 26.0, 0.25, 0.26, lambda t: 0.7 + 0.5 * (t - 21) / 5)
bass(21.0, 26.0, 0.55, 0.5)
for t in np.arange(21.0, 25.5, 0.5): kick(t, 0.8 if t % 1 == 0 else 0.45)
for t in np.arange(21.5, 25.5, 1.0): clap(t, 0.34)
for t in np.arange(21.25, 25.5, 0.25): hat(t, 0.06 + 0.04 * ((t - 21) / 4.5))
M.put('fx', swept_noise(3.1, lambda u: 400 * (9000 / 400) ** (u ** 1.3), 1.2) * np.linspace(0.25, 1, n_(3.1)) ** 1.6, 22.0, 0.34, rev=0.4)
M.put('fx', glide_sine(3.1, 146.8, 1174.7, 1.0) * np.linspace(0.1, 1, n_(3.1)) ** 2, 22.0, 0.16, rev=0.5)
for t in (22.0, 24.0): M.put('drums', sub(46, 1.4, 0.7), t, 0.5); M.put('music', bell(hz('D5' if t == 22.0 else 'F5'), 3.0, 0.8), t, 0.18, rev=0.7)
roll = np.concatenate([np.arange(24.0, 25.0, 0.25), np.arange(25.0, 25.5, 0.125), np.arange(25.5, 25.88, 0.0625)])
for i, t in enumerate(roll):
    M.put('drums', tom(170 + 100 * i / len(roll), 100, 0.18, 0.03, 0.06), t, 0.1 + 0.5 * i / len(roll), pan=(-1) ** i * 0.35)
M.put('fx', riser(1.9, 400, 9500), 24.0, 0.5, rev=0.2)
M.put('fx', whoosh(0.7, 800, 8500, 1.5, 'rise', 1.0), 25.5, 0.55, rev=0.15)   # blade wipe

# ================================================================================================ S7 : logo (26 - 32)
# the hit as the paper opens
big_hit(26.0, 1.0, 0.6, 0.55)
M.put('music', bell(hz('D5'), 3.5, 1.0), 26.0, 0.28, rev=0.8)
M.put('fx', whoosh(0.9, 3800, 400, 1.4, 'fall'), 26.0, 0.5, rev=0.3)
# ring crescents
M.put('fx', whoosh(0.7, 700, 5200, 0.8, 'bell'), 26.12, 0.3, pan=-0.4, rev=0.6)
M.put('fx', whoosh(0.5, 1000, 6000, 0.8, 'bell'), 26.26, 0.22, pan=0.5, rev=0.6)
# the mantis' arms
for t, g, nm in [(26.57, 0.34, 'G3'), (26.69, 0.3, 'A3')]:
    M.put('fx', shing(0.6, 0.07), t, g, rev=0.3); M.put('drums', tom(130, 70, 0.4, 0.05, 0.14), t, 0.4)
    M.put('music', pluck(hz(nm), 1.4, 0.5), t, 0.3, rev=0.5)
# head lands
M.put('fx', glide_sine(0.35, 400, 3200, 1.4) * np.linspace(0, 1, n_(0.35)) ** 1.5, 27.05, 0.18, rev=0.4)
M.put('drums', tom(140, 62, 0.6, 0.06, 0.2), 27.4, 0.75, rev=0.1); M.put('drums', sub(54, 1.2, 0.5), 27.4, 0.5)
M.put('music', bell(hz('A4'), 3.0, 1.0), 27.4, 0.34, rev=0.75)
# letters rise: staccato ascending run
for i, (dl, nm) in enumerate(zip([0, 0.04, 0.09, 0.14, 0.19, 0.24, 0.29], ['D4', 'F4', 'G4', 'A4', 'C5', 'D5', 'F5'])):
    t = 27.17 + dl
    M.put('music', pluck(hz(nm), 1.0, 0.65), t, 0.32, pan=-0.5 + i / 6, rev=0.5)
    M.put('music', wood(1800 + 120 * i, 0.08), t, 0.14, pan=-0.5 + i / 6)
# the slash flies, then the LOGO lands on 28.0
M.put('fx', riser(0.5, 500, 9500), 27.52, 0.6, rev=0.15)
M.put('fx', glide_sine(0.5, 200, 3000, 1.6) * np.linspace(0, 1, n_(0.5)) ** 2.2, 27.52, 0.22, rev=0.3)
M.duck[n_(27.93):n_(28.0)] *= 0.25
big_hit(28.0, 1.15, 0.7, 0.6)
for nm, g in [('D4', 0.5), ('A4', 0.45), ('F#5', 0.4), ('D6', 0.3), ('A5', 0.25)]:
    M.put('music', bell(hz(nm), 4.6, 1.0), 28.0, g, rev=0.8)
M.put('pad', pad([hz('D2'), hz('A2'), hz('D3'), hz('A3'), hz('F#4')], 4.5, 3400, 0.09), 28.0, 0.34)
M.put('drums', sub(36.7, 3.0, 1.6, 0.25), 28.0, 0.5)
# tagline + glint: twinkles
twink = ['D6', 'A5', 'F#6', 'A6', 'D7', 'F#6', 'A5', 'D6', 'F#5', 'A6']
for i, nm in enumerate(twink):
    t = 28.4 + i * 0.075 + (0.02 if i % 2 else 0)
    M.put('music', bell(hz(nm), 1.8, 1.0), t, 0.07, pan=np.sin(i * 2.1) * 0.7, rev=0.8)
M.put('fx', whoosh(0.7, 1500, 9500, 0.9, 'bell'), 28.72, 0.08, pan=0.2, rev=0.6)
M.put('fx', glide_sine(0.65, 2800, 9000, 1.0) * np.sin(np.pi * np.linspace(0, 1, n_(0.65))) ** 1.5, 28.72, 0.07, rev=0.7)
# outro: gentle notes over the sustained chord
for t, nm, g in [(29.4, 'D5', 0.18), (30.0, 'A4', 0.15), (30.6, 'F#5', 0.14), (31.1, 'D5', 0.1)]:
    M.put('music', pluck(hz(nm), 2.2, 0.5), t, g, pan=0.2, rev=0.7)
M.put('music', bell(hz('A5'), 3.0, 0.5), 30.4, 0.08, rev=0.85)

# ================================================================================================ mixdown
IR = make_ir()
gains = {'drums': 1.0, 'bass': 0.9, 'music': 1.0, 'pad': 1.0, 'fx': 1.0}
dry = np.zeros((2, N))
for k, b in M.buses.items():
    d = b.copy()
    if k in ('pad', 'music'): d *= M.duck
    dry += d * gains[k]
wet = np.stack([sg.fftconvolve(M.send[c], IR[c])[:N] for c in range(2)])
mix = dry + wet * 0.55
# gentle glue + soft clip
mix = np.tanh(mix * 0.9) / np.tanh(0.9)
mix = np.stack([sg.sosfilt(sg.butter(2, 28, 'high', fs=SR, output='sos'), mix[c]) for c in range(2)])
# final fade
fo = n_(1.6); mix[:, -fo:] *= np.linspace(1, 0, fo) ** 1.6
mix[:, :n_(0.02)] *= np.linspace(0, 1, n_(0.02))
peak = np.abs(mix).max()
mix = mix / peak * 0.8
sf.write('build/audio.wav', mix.T, SR, subtype='PCM_24')
print('audio written; peak', 20 * np.log10(np.abs(mix).max()), 'dBFS; rms', 20 * np.log10(np.sqrt((mix ** 2).mean())), 'dBFS')
