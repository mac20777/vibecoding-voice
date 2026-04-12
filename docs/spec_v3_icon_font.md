# 图标字体扩展需求 — 天气页面 + 设置页优化

## 当前图标字体现状

项目使用 **IcoMoon 自定义 Icon Font** + **LVGL lv_font_conv** 方案：

### 已有图标 (`font_zectrix.h`)

| 类别 | 图标 | Unicode | 说明 |
|------|------|---------|------|
| **电池** | Battery Empty/25/50/75/Full/Charging | e905, e902-e904, e901, e90c | 6 个 |
| **WiFi** | Full/Fair/Weak/Slash | e90e-e910, e906 | 4 个 |
| **状态** | Mic/Speaker/Mute/Setting/Power/Reboot/Sync | e900, e909, e90b, e90d, e912, e914, e913 | 7 个 |
| **UI** | Checkbox/Checkbox-OK/Todo | e911, e90a, e907 | 3 个 |
| **数字** | 0-9 | e91f, e908, e917-e91e | 10 个 |
| **其他** | Colon/1 | e915, e908 | 2 个 |

**共 32 个图标，16px 和 48px 两种尺寸。**

生成工具链：
```bash
lv_font_conv --font docs/zectrix_fonts_new/fonts/icomoon.ttf --format lvgl \
  --lv-include lvgl.h --bpp 1 --size 16 -r 0x0-0xfffff \
  -o main/components/78__xiaozhi-fonts/src/font_zectrix_16_1.c
```

### 字体文件结构
- `components/78__xiaozhi-fonts/src/font_zectrix_16_1.c` — 16px 图标
- `components/78__xiaozhi-fonts/src/font_zectrix_48_1.c` — 48px 图标
- `components/78__xiaozhi-fonts/include/font_zectrix.h` — Unicode 宏定义

---

## 需求 1：新增天气图标（Icon Font 扩展）

### 需要新增的图标

| 图标名称 | 建议 Unicode | 用途 | 尺寸 |
|---------|-------------|------|------|
| **☀️ 太阳** | e920 | 晴天天气页面 | 48px |
| **☁️ 云朵** | e921 | 多云天气页面 | 48px |
| **⛅ 多云转晴** | e922 | 半阴半晴 | 48px |
| **🌧️ 下雨** | e923 | 雨天天气页面 | 48px |
| **🌩️ 雷暴** | e924 | 雷电天气页面 | 48px |
| **❄️ 雪花** | e925 | 雪天天气页面 | 48px |
| **🌫️ 雾/霾** | e926 | 雾霾天气页面 | 48px |
| **💨 风** | e927 | 大风/风向 | 32px |
| **🌡️ 温度** | e928 | 温度计图标 | 24px |
| **💧 湿度** | e929 | 水滴/湿度图标 | 24px |
| **🌅 日出** | e92a | 日出时间 | 24px |
| **🌇 日落** | e92b | 日落时间 | 24px |
| **📍 位置** | e92c | 城市位置标记 | 20px |

### 设计要求
- **单色（1bpp）**，适配 400x300 墨水屏
- 线条简洁，避免过多细节（墨水屏对细线条不友好）
- 云朵要有层次感但不要太复杂
- 下雨图标要有 3-4 条斜线雨滴
- 所有图标在 48px 尺寸下清晰可辨

### 实施步骤
1. 使用 IcoMoon (https://icomoon.io) 或类似工具，导入已有图标 + 新增天气图标
2. 导出新的 `icomoon.ttf` 到 `docs/zectrix_fonts_new/fonts/`
3. 用 `lv_font_conv` 重新生成 `font_zectrix_16_1.c` 和 `font_zectrix_48_1.c`
4. 更新 `include/font_zectrix.h` 添加新图标宏定义
5. 在天气页面中使用新图标

---

## 需求 2：设置页面图标优化

### 当前问题
- 设置页纯文字列表，没有图标
- 选项之间区分度低

### 优化方案
在每个设置项前加上对应图标：

| 设置项 | 图标 | Unicode |
|-------|------|---------|
| WiFi 设置 | WiFi | e90e |
| 语言 | 无新增 | — |
| 音量 | Speaker | e909 |
| 清屏 | Checkbox | e911 |
| 重连 | Sync | e913 |
| 重启 | Reboot | e914 |
| 设置 | Setting | e90d |

### 布局建议（400x300）
```
┌──────────────────────────────┐
│ ⚙️ 设置                      │  ← 16px 图标 + 标题
├──────────────────────────────┤
│ 📶 WiFi: MyNetwork           │  ← 16px 图标 + 文字
│ 🔊 音量: 80%                 │
│ 🌐 语言: 中文                │
│ [x] 清屏                     │
│ [ ] 重连                     │
│ [ ] 重启                     │
│ [ ] 返回                     │
└──────────────────────────────┘
```

---

## 需求 3：天气页面图标布局

### 目标布局（400x300）

```
┌──────────────────────────────┐
│ 📍 杭州         ☁️ 24°C      │  ← 位置 + 主图标温度
│                              │
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━┓   │
│ ┃  多云转晴              ┃   │  ← 天气描述
│ ┃  体感 26°C  湿度 65%  ┃   │  ← 详细数据
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━┛   │
│                              │
│ 💧 湿度 65%   🌡️ 26°C      │  ← 底部详细
│ 💨 东南风 2级  🌅 05:42     │
│ 🌇 18:56                    │
│                              │
│ ━━━ 未来三天预报 ━━━        │
│ 周一 ☀️ 28°C  周二 🌧️ 22°C │
│ 周三 ⛅ 25°C                 │
└──────────────────────────────┘
```

### 图标尺寸分配
- **主天气图标**（温度旁）：48px
- **详细数据图标**（湿度/温度/风/日出/日落）：24px
- **预报小图标**：16px

---

## 技术约束

1. **ESP32-S3 资源有限**：
   - Flash: 8MB（当前固件 ~4MB）
   - PSRAM: 8MB
   - 每个 16px 图标约 32 字节，48px 图标约 288 字节
   - 13 个新图标增加约 **4KB FLASH**，完全可接受

2. **LVGL 字体格式**：
   - 使用 `--bpp 1` 单色模式
   - `-r 0x0-0xfffff` 覆盖所有可能的 Unicode

3. **编译命令**：
   ```bash
   cd firmware
   # 16px
   lv_font_conv --font docs/zectrix_fonts_new/fonts/icomoon.ttf --format lvgl \
     --lv-include lvgl.h --bpp 1 --size 16 -r 0x0-0xfffff \
     -o main/components/78__xiaozhi-fonts/src/font_zectrix_16_1.c
   # 48px
   lv_font_conv --font docs/zectrix_fonts_new/fonts/icomoon.ttf --format lvgl \
     --lv-include lvgl.h --bpp 1 --size 48 -r 0x0-0xfffff \
     -o main/components/78__xiaozhi-fonts/src/font_zectrix_48_1.c
   ```

## 验收标准
1. 新增 13 个天气图标在 IcoMoon 中导出为 TTF
2. 重新生成 `font_zectrix_16_1.c` 和 `font_zectrix_48_1.c`
3. `font_zectrix.h` 添加新图标宏
4. 设置页面使用图标装饰
5. 天气页面使用图标布局
6. 编译通过
