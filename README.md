# Polyfall

不止七块的俄罗斯方块：**任意 3–5 格多格骨牌**（4×4 内连通图案，共 26 种），
外加一个懂每种方块的 AI——它能给每个方块实时评分、按你的设置把最难的那块发给你，
也能用三档"落点提示"当你的教练。

打开浏览器即玩，也可以下载单文件直接运行（零依赖）。

## 运行

### 下载（推荐）

到 [Releases](../../releases) 下载对应系统的文件：

| 系统 | 文件 |
|---|---|
| Linux | `polyfall-linux` |
| macOS | `polyfall-macos` |
| Windows | `polyfall-windows.exe` |

运行后浏览器会自动打开 `http://localhost:8000`（Linux / macOS 下可能需先 `chmod +x`）。

### 从源码

需要 Python 3.11+ 与 [uv](https://docs.astral.sh/uv/)：

```bash
uv sync
uv run python run.py
```

同目录 `.env` 可改端口与是否自动打开浏览器。

## 操作

| 按键 | 功能 |
|---|---|
| ← → | 移动（长按连发） |
| ↑ / X | 顺时针旋转 |
| Z | 逆时针旋转 |
| ↓ | 软降 |
| 空格 | 硬降 |
| C | 暂存 |
| A | AI 辅助：关 / L1 / L2 / L3 循环 |
| P | 暂停 · R | 重开 |

触屏玩家可用页面侧边按钮（支持长按连发）。

## 玩法要点

- **难度**：0–100% 无极调节，数值是"把当前最难块发给你的概率"
- **AI 辅助**：青色轮廓标出建议落点，三档聪明度；新块出生先给快速提示，随后精算替换
- **风格**：暗夜 / 像素 / 霓虹 / 纸白 / 深海 / 樱花 / 终端
- **等级加速**：每消 10 行升 1 级，可关闭
- 幽灵块、暂存、下一块预览、音效、分难度最高分

## 参考

- Dellacherie (1988)；Fahey (2003)；Thiery & Scherrer (2009)
- DT-10/DT-20 权重：Gabillon et al. (2013)；Scherrer et al. (2015)；Chen et al. (2026, arXiv:2603.26765)
- "最难方块"规则：HATETRIS（qntm, 2010）

## License

MIT
