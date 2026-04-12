# 墨水屏固件 UI 重构 Spec (v4 - LVGL Migration)

> **目标**: 基于 `esp_epaper` + LVGL 重构 `vibecoding-voice` 固件，实现现代化、组件化、美观的 UI。
> **硬件**: ZecTrix Note 4 (ESP32-S3, 8MB PSRAM, 400x300 墨水屏).

## 一、架构设计原则 (Architecture)

本重构不仅是 UI 库的替换，更是代码结构的重构。**清晰的架构** 是核心目标。

### 1.1 组件抽象与复用 (Componentization)
- **组件化开发**: 摒弃过程式的 `draw_xxx` 函数，改为创建 LVGL 对象并维护其状态。
- **自定义 Widget 封装**: 
  - `create_chat_bubble(parent, text, is_user)`: 封装圆角气泡、背景色、文本自动换行。
  - `create_weather_card(parent, data)`: 封装天气图标、温度文字。
  - `create_battery_indicator(parent)`: 封装横向 3 节电池逻辑。
- **复用**: 提取公共样式 (Style) 对象，如 `style_bubble_user`, `style_bubble_ai`，避免代码冗余。

### 1.2 层次解耦 (Decoupling)
- **UI 层 (View)**: 仅负责 LVGL 对象的创建、布局和显示更新。
- **业务层 (Model/Controller)**: `LanMicApp` 保持 WebSocket, ASR, LLM, WiFi 逻辑不变。
- **通信**: 通过 **回调函数 (Callbacks)** 或 **事件分发** 连接两层。
  - 例：收到 LLM 文本 -> `LanMicApp` 调用 `chat_ui_append_text(text)` -> UI 更新气泡并滚动。

### 1.3 可维护性 (Maintainability)
- **日志**: 关键状态切换、UI 更新必须打印 `ESP_LOGI(kTag, "UI: ...")`。
- **注释**: 所有 LVGL 布局参数、回调逻辑必须有 **中文注释**，解释 *为什么* 这么写。
- **模块化**: 建议按功能拆分文件 (如 `ui_chat.c`, `ui_weather.c`) 或在 `lan_mic_app.cc` 中清晰分块。

---

## 二、开发环境配置 (Environment Setup)

**⚠️ 重要提示：你的开发环境已经完备，严禁重新运行安装脚本！**

### 2.1 环境变量 (必须配置)
在编译或安装组件前，请设置以下环境变量（或在脚本中 export）：
```bash
# ESP-IDF 路径
export IDF_PATH=~/Documents/esp/v6.0/esp-idf
export ESP_IDF_VERSION=6.0.0
export IDF_PYTHON_ENV_PATH=~/.espressif/python_env/idf6.0_py3.13_env
export ESP_ROM_ELF_DIR=~/Documents/espressif/tools/esp-rom-elfs/20241011

# 路径 (必须包含 IDF 工具链)
export PATH="$IDF_PYTHON_ENV_PATH/bin:$IDF_PATH/tools:\
~/Documents/espressif/tools/xtensa-esp-elf/esp-15.2.0_20251204/xtensa-esp-elf/bin:\
~/Documents/espressif/tools/riscv32-esp-elf/esp-15.2.0_20251204/riscv32-esp-elf/bin:\
~/Documents/espressif/tools/esp32ulp-elf/2.38_20240113/esp32ulp-elf/bin:\
~/Documents/espressif/tools/openocd-esp32/v0.12.0-esp32-20251215/openocd-esp32/bin:\
~/Documents/espressif/tools/xtensa-esp-elf-gdb/16.3_20250913/xtensa-esp-elf-gdb/bin:\
~/Documents/espressif/tools/ninja/1.12.1:$PATH"
```

### 2.2 禁忌操作
- ❌ **禁止运行** `./install.sh` 或 `idf_tools.py install`。工具链已存在于 `~/Documents/espressif/tools/` 下。
- ❌ **禁止删除** `managed_components` 目录，除非需要重新下载。
- ❌ **禁止** 尝试重新下载 `xtensa-esp-elf` 等工具。

---

## 三、核心架构变更 (Migration Plan)

### 3.1 废弃旧逻辑
- **删除**: `DrawTexts`, `DrawBubble`, `DrawHorizontalLine` 等所有 `display_->...` 的 Raw Draw 调用。
- **废弃**: `CustomLcdDisplay` 中的手动缓冲区操作。

### 3.2 引入 LVGL + esp_epaper
- **依赖安装**: `idf.py add-dependency "tuanpmt/esp_epaper^1.0.0"`
- **初始化流程**:
  1.  初始化 SPI/CS/RST/Busy 引脚。
  2.  调用 `esp_epaper_init()`。
  3.  创建 `lv_display_t`，配置 flush callback 指向墨水屏驱动。
  4.  **显存分配**: 必须利用 **PSRAM** (`heap_caps_malloc(..., MALLOC_CAP_SPIRAM)`)，避免耗尽 SRAM。

### 3.3 页面管理 (View Hierarchy)
使用 `lv_tabview` 或自定义 `lv_obj` 容器管理 5 个主要页面：
1.  **对话 (AI Chat)**
2.  **天气 (Weather)**
3.  **人生进度 (LifeBar)**
4.  **黄历 (Almanac)**
5.  **设置 (Settings)**

- **切换逻辑**: 通过物理按键 (Boot/Up/Down) 改变当前 Tab Index，触发 `LV_EVENT_VALUE_CHANGED` 刷新页面。

---

## 四、重点页面规范

### 4.1 AI 对话页 (AI Chat)
- **布局**: `LV_FLEX_FLOW_COLUMN` 垂直滚动容器。
- **组件设计**:
  - **用户气泡**: `lv_obj` (圆角, 黑底 `LV_PALETTE_BLACK`) + `lv_label` (白字). `LV_OBJ_FLAG_FLEX_IN_NEW_TRACK` (如果需要).
  - **AI 气泡**: `lv_obj` (圆角, 灰底 `LV_PALETTE_GREY`) + `lv_label` (黑字).
  - **文本处理**: `lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP)` 确保不溢出屏幕。
- **交互**: 
  - 收到消息时创建新 Bubble。
  - 每次添加内容后调用 `lv_obj_scroll_to_view(child, LV_ANIM_OFF)`.

### 4.2 天气看板页 (Weather)
- **布局**: `LV_GRID` (网格布局) 实现非对称排版。
- **组件**:
  - **大字温度**: 48px+ Label, 居中。
  - **图标**: 使用 `lv_image` (需转换 PNG 为 C 数组或使用 LVGL 图片解码器，考虑到墨水屏特性，建议先用文字字符或 LVGL 符号作为占位，后期优化为图片)。
  - **进度条**: `lv_bar` (禁用动画 `LV_ANIM_OFF`), 圆角样式。

### 4.3 设置页 (Settings)
- **组件**: `lv_list`.
- **项目**:
  - WiFi 状态 (含图标).
  - 音量调节 (带回调).
  - 电池预览 (新增调试功能).
  - 重启/关机.
- **样式**: 使用 LVGL 默认 Focus 样式，高亮当前选中项 (反色显示)。

---

## 五、开发约束

- **字体**: 必须集成 `SourceHanSansSC` (中文) 和 `Lora` (数字). 确保 LVGL 字体转换器正确配置。
- **内存**: 
  - `lv_conf.h` 中配置 `LV_MEM_CUSTOM=1` (如果适用) 或直接使用系统堆。
  - 确保 `CONFIG_SPIRAM_USE_MALLOC=y` 开启。
- **刷新**: 禁用动画 `LV_USE_ANIMATION=0`。仅在数据变化时手动调用 `lv_refr_now(NULL)` 或依赖脏区刷新。
- **编译**: Claude 写完代码后，必须执行 `idf.py build` 验证通过。