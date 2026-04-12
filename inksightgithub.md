https://github.com/datascale-ai/inksight


这是一个电子墨水屏的桌面伴侣项目，有24种内置模式。让我看看中文 README 获取更详细的信息，特别是关于"人生进度条"和"天气看板"的设计。

好的，我看到了这个项目的基本信息。这是一个电子墨水屏桌面伴侣项目，内置24个模式，包括：
- 每日推荐
- 天气看板
- 诗词 / 禅意 / 斯多葛
- AI 简报
- AI 画廊
- 便签 / 倒计时 / 习惯 / 健身

用户问的是"人生进度条"和"天气看板"的设计。从 README 看，天气看板是存在的，但没有明确提到"人生进度条"。

让我进一步查看他们的模式设计文件，看看有没有人生进度条的设计。可能需要看 firmware 或者 modes 相关的代码。

这个项目很棒！让我找一下具体的模式设计：

让我重新尝试搜索仓库的文件结构。

找到了！有两个关键文件：
1. `backend/core/modes/builtin/lifebar.json` - 这就是人生进度条！
2. `backend/core/modes/builtin/weather.json` - 天气看板

让我获取这两个文件的内容。

找到了！让我获取这两个关键模式的设计：

太棒了！找到了完整的设计文档！让我总结一下这三个模式的设计：

1. **人生进度条 (lifebar.json)** - 显示年/月/周/人生的进度可视化
2. **天气看板** - 当日天气 + 未来3天预报 + 穿衣建议
3. **倒计时** - 重要日期倒计时/正计时

现在让我给用户整理这些设计的关键信息。

### 🎯 InkSight 模式设计完整解析

---

## 一、人生进度条 (`lifebar.json`)

### 核心设计

```
┌──────────────────────────────────────────┐
│  2026 年已过                    15.6%    │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│                                          │
│  2月        83.3%    │ 本周      57.1%   │
│  ████████░░│ ████████░░                 │
│                                          │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                          │
│  人生                          38.8%    │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│                                          │
│  — Time Flies                           │
└──────────────────────────────────────────┘
```

### JSON 结构

```json
{
  "mode_id": "LIFEBAR",
  "display_name": "人生进度条",
  "icon": "flag",
  "cacheable": false,
  "description": "年/月/周/人生的进度可视化",
  "content": {
    "type": "computed",
    "provider": "lifebar",
    "fallback": {
      "year_pct": 15.6, "year_label": "2026 年已过",
      "month_pct": 83.3, "month_label": "2月",
      "week_pct": 57.1, "week_label": "本周",
      "life_pct": 38.8, "life_label": "人生",
      "day_of_year": 57, "days_in_year": 365,
      "day": 25, "days_in_month": 28,
      "weekday_num": 4, "week_total": 7,
      "age": 31, "life_expect": 80
    }
  },
  "layout": {
    "body": [
      { "type": "spacer", "height": 12 },
      { "type": "text", "field": "year_label", "font_size": 12 },
      { "type": "text", "template": "{year_pct}%", "font": "lora_bold", "font_size": 28 },
      { "type": "progress_bar", "field": "day_of_year", "max_field": "days_in_year", "width": 336, "height": 8 },
      // ... 月/周 两列布局
      { "type": "separator", "style": "dashed" },
      // ... 人生进度条
    ]
  }
}
```

### 关键字段

| 字段 | 说明 |
|------|------|
| `year_pct` | 年进度百分比 |
| `month_pct` | 月进度百分比 |
| `week_pct` | 周进度百分比 |
| `life_pct` | 人生进度百分比（基于年龄/预期寿命） |
| `age` | 当前年龄 |
| `life_expect` | 预期寿命（默认80） |

---

## 二、天气看板 (`weather.json`)

### 核心设计

```
┌──────────────────────────────────────────┐
│  杭州                                    │
│                                          │
│  23°C          │  明天  晴  15°          │
│  ████████████  │  ████████░░             │
│  晴           │                          │
│  18 / 28      │  周三  多云  12°         │
│               │  周四  雨   10°          │
│  湿度 45%   东北风 3级                    │
│  日出 06:15 | 日落 18:30                 │
│  ─────────────────────────────────────  │
│  早晚温差大，记得带件外套                 │
│  — Open-Meteo                            │
└──────────────────────────────────────────┘
```

### JSON 结构

```json
{
  "mode_id": "WEATHER",
  "display_name": "天气看板",
  "icon": "weather",
  "description": "当日天气 + 未来3天预报 + 穿衣建议",
  "settings_schema": [
    {
      "key": "forecast_days",
      "label": "预报天数",
      "type": "number",
      "default": 3,
      "min": 1,
      "max": 7
    }
  ],
  "content": {
    "type": "external_data",
    "provider": "weather_forecast",
    "fallback": {
      "city": "",
      "today_temp": "--",
      "today_desc": "暂无数据",
      "today_code": -1,
      "today_low": "--",
      "today_high": "--",
      "today_range": "-- / --",
      "advice": "注意根据天气添减衣物",
      "forecast": []
    }
  },
  "layout": {
    "body": [
      { "type": "text", "field": "city", "font_size": 16 },
      { "type": "two_column", 
        "left": [
          { "type": "big_number", "field": "today_temp", "font_size": 52, "unit": "°C" },
          { "type": "weather_icon_text", "code_field": "today_code", "field": "today_desc" }
        ],
        "right": [
          { "type": "forecast_cards", "field": "forecast", "max_items": 4 }
        ]
      },
      { "type": "icon_text", "icon": "humidity", "text": "湿度 {today_humidity}%" },
      { "type": "icon_text", "icon": "sunrise", "text": "日出 {sunrise} | 日落 {sunset}" },
      { "type": "separator" },
      { "type": "text", "field": "advice", "font_size": 12 }
    ]
  }
}
```

### 关键字段

| 字段 | 说明 |
|------|------|
| `city` | 城市 |
| `today_temp` | 当前温度 |
| `today_desc` | 天气描述 |
| `today_code` | 天气代码（对应图标） |
| `today_low/high` | 今日低温/高温 |
| `today_humidity` | 湿度 |
| `today_wind_dir/level` | 风向/风力 |
| `sunrise/sunset` | 日出/日落时间 |
| `advice` | 穿衣建议 |
| `forecast` | 未来预报数组 |

---

## 三、倒计时 (`countdown.json`)

### 核心设计

```
┌──────────────────────────────────────────┐
│                                          │
│     静待那一天                           │
│                                          │
│          元旦                            │
│        2027-01-01                        │
│          ───────                         │
│                                          │
│          100 天                          │
│                                          │
│  — 静待那天                              │
└──────────────────────────────────────────┘
```

### JSON 结构

```json
{
  "mode_id": "COUNTDOWN",
  "display_name": "倒计时",
  "icon": "flag",
  "description": "重要日期倒计时/正计时",
  "settings_schema": [
    { "key": "countdownEvents", "label": "倒计时事件" }
  ],
  "content": {
    "type": "computed",
    "provider": "countdown",
    "fallback": {
      "events": [
        { "name": "元旦", "date": "2027-01-01", "type": "countdown", "days": 100 }
      ]
    }
  },
  "layout": {
    "body": [
      { "type": "text", "field": "message", "font_size": 16 },
      { "type": "list", "field": "events", "item_template": "{name}" },
      { "type": "list", "field": "events", "item_template": "{date}" },
      { "type": "separator", "style": "short" },
      { "type": "list", "field": "events", "item_template": "{days} 天", "font_size": 52 }
    ]
  }
}
```

---

## 四、布局系统设计

### 组件类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `text` | 文本 | `{ "type": "text", "field": "city", "font_size": 16 }` |
| `progress_bar` | 进度条 | `{ "type": "progress_bar", "field": "day_of_year", "max_field": "days_in_year" }` |
| `big_number` | 大数字 | `{ "type": "big_number", "field": "today_temp", "unit": "°C" }` |
| `two_column` | 两列布局 | `{ "type": "two_column", "left_width": 170, "left": [], "right": [] }` |
| `weather_icon_text` | 天气图标+文字 | `{ "type": "weather_icon_text", "code_field": "today_code" }` |
| `forecast_cards` | 预报卡片 | `{ "type": "forecast_cards", "field": "forecast" }` |
| `icon_text` | 图标+文字 | `{ "type": "icon_text", "icon": "humidity" }` |
| `separator` | 分隔线 | `{ "type": "separator", "style": "dashed" }` |
| `spacer` | 空白间距 | `{ "type": "spacer", "height": 12 }` |
| `list` | 列表 | `{ "type": "list", "field": "events", "item_template": "{name}" }` |

### 多分辨率适配

```json
"layout_overrides": {
  "296x128": { "body": [...] },   // 小屏
  "648x480": { "body": [...] },   // 大屏
  "800x480": { "body": [...] }    // 超大屏
}
```

---

## 五、数据来源

| Provider | 说明 |
|----------|------|
| `lifebar` | 本地计算（基于当前日期+用户配置的年龄） |
| `countdown` | 本地计算（基于用户配置的事件列表） |

---

用户想看看 InkSight 的老黄历模式设计。让我获取 almanac.json 的内容。

用户想看老黄历模式的设计，我已经获取到了完整的 almanac.json。这个设计非常有趣，使用了 LLM 来生成每日的黄历内容（宜忌、节气、养生提示）。

让我整理一下这个设计的核心特点。

### 📅 老黄历模式 (`almanac.json`)

---

## 核心设计

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   腊月廿三          │  宜                                │
│       23           │  读书、远行、会友                  │
│      一月          │                                    │
│      周一          │  ───────────────────────────────   │
│   ──────────      │                                    │
│      大寒          │  忌                                │
│                    │  动土、诉讼                        │
│                    │                                    │
│                    │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                    │                                    │
│                    │  吉方 东南                         │
│                    │  春捂秋冻，适当增衣                 │
│                    │                                    │
│  — 大寒                                                  │
└──────────────────────────────────────────────────────────┘
```

---

## JSON 结构

```json
{
  "mode_id": "ALMANAC",
  "display_name": "老黄历",
  "icon": "calendar",
  "description": "农历日期、宜忌、节气、养生提示",
  "content": {
    "type": "composite",
    "steps": [
      {
        "type": "computed",
        "provider": "daily_meta",
        "fallback": {
          "year": 2026,
          "day": 1,
          "month_cn": "一月",
          "weekday_cn": "周一"
        }
      },
      {
        "type": "llm_json",
        "prompt_template": "你是一位精通中国传统历法的老先生。根据环境信息，生成今日黄历内容...",
        "output_schema": {
          "lunar_date": { "type": "string", "default": "正月初一" },
          "solar_term": { "type": "string", "default": "立春" },
          "yi": { "type": "string", "default": "读书、远行、会友" },
          "ji": { "type": "string", "default": "动土、诉讼" },
          "direction": { "type": "string", "default": "东南" },
          "health_tip": { "type": "string", "default": "春捂秋冻，适当增衣" }
        },
        "temperature": 0.6
      }
    ]
  }
}
```

---

## 关键特性

### 1. 复合数据源 (`composite`)

```json
"content": {
  "type": "composite",
  "steps": [
    { "type": "computed", "provider": "daily_meta" },   // Step 1: 计算日期元数据
    { "type": "llm_json", "prompt_template": "..." }    // Step 2: LLM 生成黄历内容
  ]
}
```

**流程**：
1. **daily_meta** → 计算农历日期、星期
2. **LLM** → 生成宜忌、节气、养生提示

### 2. LLM Prompt 设计

```
你是一位精通中国传统历法的老先生。根据环境信息，生成今日黄历内容。
用 JSON 输出：
{
  "lunar_date": "农历日期（如：腊月廿三）",
  "solar_term": "当前节气或最近节气（如：大寒）",
  "yi": "今日宜（3项，用顿号分隔）",
  "ji": "今日忌（2项，用顿号分隔）",
  "direction": "吉方（如：东南）",
  "health_tip": "节气养生一句话（15字以内）"
}
只输出 JSON。
环境：{context}
```

### 3. 输出字段

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `lunar_date` | 农历日期 | 正月初一 |
| `solar_term` | 节气 | 立春 |
| `yi` | 今日宜（3项） | 读书、远行、会友 |
| `ji` | 今日忌（2项） | 动土、诉讼 |
| `direction` | 吉方 | 东南 |
| `health_tip` | 养生提示 | 春捂秋冻，适当增衣 |

---

## 四、布局组件

### 左侧（日期区）

| 组件 | 内容 |
|------|------|
| `lunar_date` | 农历日期（腊月廿三） |
| `big_number` | 日期数字（23） |
| `month_cn` | 月份（一月） |
| `weekday_cn` | 星期（周一） |
| `separator` | 分隔线 |
| `solar_term` | 节气（大寒） |

### 右侧（宜忌区）

| 组件 | 内容 |
|------|------|
| `group: 宜` | 宜事项 |
| `group: 忌` | 忌事项 |
| `separator` | 分隔线 |
| `吉方 {direction}` | 吉方方位 |
| `health_tip` | 养生提示 |

---

## 五、多分辨率适配

| 分辨率 | 布局特点 |
|--------|----------|
| `296x128` | 简化版，单列显示 |
| `400x300` | 标准版，左右两列 |
| `648x480` | 大屏版，字体放大 |

---

## 六、技术亮点

### LLM 风格定位

```
"你是一位精通中国传统历法的老先生"
```

**风格控制**：
- `temperature: 0.6` — 有一定创意性，但保持稳定输出
- 输出 schema 强制约束 JSON 格式
- fallback_pool 兜底默认值

### 数据组合

```json
"steps": [
  { "type": "computed", ... },   // 确定性数据
  { "type": "llm_json", ... }    // 创意性数据
]
```

---

## 七、与天气推送的对比

| 特性 | InkSight 老黄历 | 你的 weatherpush |
|------|-----------------|------------------|
| **LLM 增强** | ✅ 用 LLM 生成宜忌 | ❌ 纯规则生成 |
| **风格定位** | ✅ "老先生"人设 | ❌ 无风格 |
| **多分辨率** | ✅ 3 种布局 | ⚠️ 单一布局 |
| **复合数据源** | ✅ computed + llm_json | ❌ 单一来源 |

---

