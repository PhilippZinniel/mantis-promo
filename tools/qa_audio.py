"""Audio QA: loudness contour, high-frequency share, onset density, cue alignment, clicks.
   python tools/qa_audio.py [wav-or-mp4]   (default build/audio.wav)"""
import json, re, subprocess, sys
import numpy as np, soundfile as sf, scipy.signal as sg

src = sys.argv[1] if len(sys.argv) > 1 else 'build/audio.wav'
if not src.endswith('.wav'):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-vn', '-ar', '48000', 'build/_qa.wav'], check=True); src = 'build/_qa.wav'
x, sr = sf.read(src); m = x.mean(1)
K = json.load(open('src/cues.json'))['t']; dur = len(m) / sr
f, t, Z = sg.stft(m, sr, nperseg=2048, noverlap=1536)
flux = np.maximum(np.diff(np.log1p(np.abs(Z) * 50), axis=1), 0).sum(0); flux /= flux.max(); tt = t[1:]
pk, _ = sg.find_peaks(flux, height=0.18, distance=int(0.06 / (tt[1] - tt[0]))); on = tt[pk]
print('sec    rms_dB  hf5k+%  onsets/s')
for a in range(0, int(dur), 2):
    s = m[a * sr:(a + 2) * sr]
    if len(s) < sr: continue
    ff, pp = sg.welch(s, sr, nperseg=4096)
    print(f'{a:2d}-{a+2:2d}  {20*np.log10(np.sqrt((s**2).mean())+1e-9):6.1f}  {pp[ff>5000].sum()/pp.sum()*100:5.1f}   {((on>=a)&(on<a+2)).sum()/2:4.1f}')
print('onsets total', len(on), 'avg/s', round(len(on) / dur, 2))
out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', src, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
print('integrated', re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1], 'LUFS | LRA', re.findall(r'LRA:\s+([\d.]+) LU', out)[-1], 'LU | true peak', re.findall(r'Peak:\s+(-?[\d.]+) dBFS', out)[-1], 'dBFS')
# cue alignment: low-band energy onsets near the big cues
# transient (click/noise) band: negligible filter latency
b = sg.butter(3, [1500, 6000], 'band', fs=sr, output='sos'); low = sg.sosfilt(b, m)
env = np.sqrt(np.convolve(low ** 2, np.ones(48) / 48, 'same')); d = np.diff(env, prepend=0) * sr
print('cue alignment (nearest transient onset within +-120 ms):')
for name in ['slash', 'titleRead', 'titleThe', 'titleWhole', 'titlePage', 'strike', 'paper', 'lock']:    # ('stays' is a sub-bass hit: not visible to the transient band)
    c = K[name] + (1.0 if name == 'stays' else 0)
    w = (np.arange(len(d)) / sr > c - 0.12) & (np.arange(len(d)) / sr < c + 0.12)
    if not w.any(): continue
    i = np.argmax(np.where(w, d, -1e9)); print(f'  {name:11s} cue {c:6.2f}s  onset {i/sr:6.3f}s  d={1000*(i/sr-c):+5.0f} ms')
# clicks
h = sg.sosfilt(sg.butter(4, 9000, 'high', fs=sr, output='sos'), m)
e = np.sqrt(np.convolve(h ** 2, np.ones(144) / 144, 'same')); bg = np.sqrt(np.convolve(h ** 2, np.ones(5760) / 5760, 'same')) + 1e-6
cl, _ = sg.find_peaks(e / bg, height=7, distance=2400)
print('click candidates:', [round(c / sr, 2) for c in cl] or 'none')
