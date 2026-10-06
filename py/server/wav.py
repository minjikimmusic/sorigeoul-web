import struct
import numpy as np

class WavError(ValueError):
    pass

def read_wav(data):
    if len(data) < 44 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise WavError('WAV 파일이 아닙니다 (RIFF/WAVE 헤더 없음)')
    fmt = None
    pos = 12
    while pos + 8 <= len(data):
        cid = data[pos:pos + 4]
        size = struct.unpack_from('<I', data, pos + 4)[0]
        body = pos + 8
        if cid == b'fmt ':
            if size < 16:
                raise WavError('fmt 청크가 너무 짧습니다')
            code, ch, sr, _, _, bits = struct.unpack_from('<HHIIHH', data, body)
            fmt = {'code': code, 'channels': ch, 'rate': sr, 'bits': bits}
        elif cid == b'data':
            if fmt is None:
                raise WavError('data 청크가 fmt보다 먼저 나왔습니다')
            raw = data[body:body + size] if size else data[body:]
            return (_decode(raw, fmt), fmt['rate'])
        pos = body + size + (size & 1)
    raise WavError('data 청크를 찾지 못했습니다')

def _decode(raw, fmt):
    ch, bits, code = (fmt['channels'], fmt['bits'], fmt['code'])
    if ch < 1:
        raise WavError(f'채널 수가 이상합니다: {ch}')
    if code == 3 and bits == 32:
        x = np.frombuffer(raw[:len(raw) // 4 * 4], dtype='<f4').astype(np.float32)
    elif code == 1 and bits == 16:
        x = np.frombuffer(raw[:len(raw) // 2 * 2], dtype='<i2').astype(np.float32) / 32768.0
    elif code == 1 and bits == 32:
        x = np.frombuffer(raw[:len(raw) // 4 * 4], dtype='<i4').astype(np.float32) / 2147483648.0
    elif code == 1 and bits == 24:
        b = np.frombuffer(raw[:len(raw) // 3 * 3], dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | b[:, 1] << 8 | b[:, 2] << 16
        x = np.where(v >= 1 << 23, v - (1 << 24), v).astype(np.float32) / 8388608.0
    elif code == 1 and bits == 8:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise WavError(f'지원하지 않는 WAV 형식입니다 (format={code}, bits={bits})')
    if ch > 1:
        n = len(x) // ch * ch
        x = x[:n].reshape(-1, ch).mean(axis=1)
    return np.ascontiguousarray(x, dtype=np.float32)

def write_wav(samples, sample_rate):
    x = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    pcm = (x * 32767.0).astype('<i2').tobytes()
    hdr = b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm))
    return hdr + pcm

def cut(samples, sample_rate, start_s, length_s, pad_s):
    n = len(samples)
    i0 = int(round(start_s * sample_rate))
    i1 = int(round((start_s + length_s) * sample_rate))
    pad = int(round(pad_s * sample_rate))
    a = max(0, i0 - pad)
    b = min(n, i1 + pad)
    if b <= a:
        raise WavError(f'녹음이 이 구간을 담고 있지 않습니다 ({start_s:.2f}~{start_s + length_s:.2f}초, 녹음 길이 {n / sample_rate:.2f}초)')
    return (samples[a:b], (i0 - a) / sample_rate, b < i1)
