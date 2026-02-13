"""Fun-ASR 工具函数"""

from itertools import groupby

import soundfile as sf
import torch
import torchaudio
import torchaudio.functional as F


def load_audio(wav_path, rate: int = None, offset: float = 0, duration: float = None):
    """加载音频文件
    
    Args:
        wav_path: 音频文件路径
        rate: 目标采样率，如果为 None 则保持原采样率
        offset: 起始偏移量（秒）
        duration: 读取时长（秒），如果为 None 则读取到文件末尾
        
    Returns:
        tuple: (音频张量, 采样率)
    """
    with sf.SoundFile(wav_path) as f:
        start_frame = int(offset * f.samplerate)
        if duration is None:
            frames_to_read = f.frames - start_frame
        else:
            frames_to_read = int(duration * f.samplerate)
        f.seek(start_frame)
        audio_data = f.read(frames_to_read, dtype="float32")
        audio_tensor = torch.from_numpy(audio_data)
        if rate is not None and f.samplerate != rate:
            if audio_tensor.ndim == 1:
                audio_tensor = audio_tensor.unsqueeze(0)
            else:
                audio_tensor = audio_tensor.T
            resampler = torchaudio.transforms.Resample(orig_freq=f.samplerate, new_freq=rate)
            audio_tensor = resampler(audio_tensor)
            if audio_tensor.shape[0] == 1:
                audio_tensor = audio_tensor.squeeze(0)
        return audio_tensor, rate if rate is not None else f.samplerate


def forced_align(log_probs: torch.Tensor, targets: torch.Tensor, blank: int = 0):
    """强制对齐
    
    Args:
        log_probs: 对数概率张量
        targets: 目标张量
        blank: 空白符号 ID
        
    Returns:
        list: 对齐结果列表
    """
    items = []
    try:
        # The current version only supports batch_size==1.
        log_probs, targets = log_probs.unsqueeze(0).cpu(), targets.unsqueeze(0).cpu()
        assert log_probs.shape[1] >= targets.shape[1]
        alignments, scores = F.forced_align(log_probs, targets, blank=blank)
        alignments, scores = alignments[0], torch.exp(scores[0]).tolist()
        # use enumerate to keep track of the original indices, then group by token value
        for token, group in groupby(enumerate(alignments), key=lambda item: item[1]):
            if token == blank:
                continue
            group = list(group)
            start = group[0][0]
            end = start + len(group)
            score = max(scores[start:end])
            items.append(
                {
                    "token": token.item(),
                    "start_time": start,
                    "end_time": end,
                    "score": round(score, 3),
                }
            )
    except:
        pass
    return items
