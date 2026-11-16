# -*- coding: utf-8 -*-
"""生成扩展图标：红色圆角底 + 白色禁止圆圈斜杠（16/48/128）
用法：pip install pillow && python gen_icons.py
图标生成到本脚本所在目录（即扩展根目录）。"""
import os
from PIL import Image, ImageDraw

OUT = os.path.dirname(os.path.abspath(__file__))


def make(size):
    S = size * 8  # 超采样抗锯齿
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = int(S * 0.06)
    d.rounded_rectangle([m, m, S - m, S - m], radius=int(S * 0.22), fill=(30, 136, 229, 255))  # #1e88e5 蓝
    c = int(S * 0.26)
    w = max(2, int(S * 0.08))
    cx = cy = S / 2
    d.ellipse([cx - c, cy - c, cx + c, cy + c], outline=(255, 255, 255, 255), width=w)
    d.line([cx - c * 0.72, cy + c * 0.72, cx + c * 0.72, cy - c * 0.72],
           fill=(255, 255, 255, 255), width=w)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    for s in (16, 48, 128):
        make(s).save(os.path.join(OUT, 'icon%d.png' % s))
        print('icon%d.png done' % s)
