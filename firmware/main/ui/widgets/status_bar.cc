#include "status_bar.h"
#include <esp_log.h>
#include <cstring>

// 外部字体
extern const lv_font_t SourceHanSansSC_Regular_slim;
extern const lv_font_t font_zectrix_16_1;

namespace ui {

constexpr char kTag[] = "StatusBar";

StatusBar::StatusBar(lv_obj_t* parent) {
    // 创建状态栏容器（固定顶部）
    container_ = lv_obj_create(parent);
    lv_obj_set_size(container_, 400, GetHeight());
    lv_obj_set_pos(container_, 0, 0);
    lv_obj_set_style_bg_color(container_, lv_color_white(), 0);
    lv_obj_set_style_bg_opa(container_, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(container_, 0, 0);
    lv_obj_set_style_pad_all(container_, 4, 0);
    lv_obj_set_style_radius(container_, 0, 0);
    lv_obj_clear_flag(container_, LV_OBJ_FLAG_SCROLLABLE);

    // WiFi 图标（左侧）- 使用 LVGL 内置符号
    wifi_icon_ = lv_label_create(container_);
    lv_obj_set_pos(wifi_icon_, 8, 8);
    lv_obj_set_style_text_font(wifi_icon_, &font_zectrix_16_1, 0);
    lv_label_set_text(wifi_icon_, LV_SYMBOL_WIFI);  // 实心 WiFi 图标

    // 状态文本（WiFi 断开时显示警告）
    status_text_ = lv_label_create(container_);
    lv_obj_set_pos(status_text_, 28, 8);
    lv_obj_set_style_text_font(status_text_, &SourceHanSansSC_Regular_slim, 0);
    lv_label_set_text(status_text_, "");

    // 页面标题（居中）
    title_label_ = lv_label_create(container_);
    lv_obj_set_style_text_font(title_label_, &SourceHanSansSC_Regular_slim, 0);
    lv_label_set_text(title_label_, "对话");
    lv_obj_align(title_label_, LV_ALIGN_CENTER, 0, 0);

    // 电池 canvas（右侧）- 绘制横向 3 节电池
    battery_canvas_ = lv_canvas_create(container_);
    lv_obj_set_pos(battery_canvas_, 352, 10);
    lv_canvas_set_buffer(battery_canvas_, battery_buffer_, kBatteryWidth, kBatteryHeight, LV_COLOR_FORMAT_L8);
    memset(battery_buffer_, 0xFF, kBatteryBufferSize);  // 初始化为白色

    // 电池百分比文字（canvas 右侧）
    battery_pct_label_ = lv_label_create(container_);
    lv_obj_set_pos(battery_pct_label_, 384, 8);
    lv_obj_set_style_text_font(battery_pct_label_, &SourceHanSansSC_Regular_slim, 0);
    lv_label_set_text(battery_pct_label_, "--");

    ESP_LOGI(kTag, "Status bar created with 3-cell battery canvas");
}

StatusBar::~StatusBar() {
    if (container_) {
        lv_obj_delete(container_);
    }
}

void StatusBar::Update(const StatusBarData& data) {
    // 更新 WiFi 图标
    if (wifi_icon_) {
        if (data.wifi_connected) {
            lv_obj_set_style_text_color(wifi_icon_, lv_color_black(), 0);
            lv_label_set_text(wifi_icon_, LV_SYMBOL_WIFI);  // 实心 WiFi
        } else {
            // 断开时显示叉号图标
            lv_obj_set_style_text_color(wifi_icon_, lv_color_make(0x80, 0x80, 0x80), 0);
            lv_label_set_text(wifi_icon_, LV_SYMBOL_CLOSE);  // 叉号
        }
    }

    // 更新状态文字（仅在离线时显示）
    if (status_text_) {
        std::string status;
        if (!data.wifi_connected) {
            status = "WiFi断开";
        } else if (!data.server_connected) {
            status = "服务离线";
        }
        lv_label_set_text(status_text_, status.c_str());
    }

    // 更新页面标题
    if (title_label_ && !data.page_title.empty()) {
        lv_label_set_text(title_label_, data.page_title.c_str());
    }

    // 绘制 3 节电池图标
    if (battery_canvas_) {
        DrawBattery3Cell(data.battery_level, data.battery_charging);
    }

    // 更新百分比文字
    if (battery_pct_label_) {
        char buf[8];
        if (data.battery_level >= 0 && data.battery_level <= 100) {
            snprintf(buf, sizeof(buf), "%d%s", data.battery_level,
                     data.battery_charging ? "+" : "");
        } else {
            snprintf(buf, sizeof(buf), "--");
        }
        lv_label_set_text(battery_pct_label_, buf);
    }
}

void StatusBar::Refresh() {
    // LVGL 自动刷新
}

void StatusBar::DrawBattery3Cell(int level, bool charging) {
    if (!battery_canvas_) return;

    // 清空画布（白色背景）
    memset(battery_buffer_, 0xFF, kBatteryBufferSize);

    // 电池参数
    constexpr int w = kBatteryWidth;    // 30
    constexpr int h = kBatteryHeight;   // 12
    constexpr int cell_w = 8;           // 每格宽度
    constexpr int gap = 2;              // 格间间隙
    constexpr int pad = 2;              // 内边距
    constexpr int head_w = 3;           // 电池头宽度

    // 计算填充格数：0-33%=1格, 34-66%=2格, 67-100%=3格
    int filled_cells = 0;
    if (level >= 0 && level <= 100) {
        if (level <= 33) filled_cells = 1;
        else if (level <= 66) filled_cells = 2;
        else filled_cells = 3;
    }

    // 低电量警告（<20% 反白）
    bool low_battery = (level >= 0 && level < 20);

    // 像素绘制辅助
    auto set_pixel = [&](int x, int y, uint8_t val) {
        if (x >= 0 && x < w && y >= 0 && y < h) {
            battery_buffer_[y * w + x] = val;  // 0=黑, 255=白
        }
    };

    auto draw_rect_filled = [&](int x1, int y1, int x2, int y2, uint8_t val) {
        for (int x = x1; x <= x2; x++) {
            for (int y = y1; y <= y2; y++) {
                set_pixel(x, y, val);
            }
        }
    };

    auto draw_rect_outline = [&](int x1, int y1, int x2, int y2, uint8_t val) {
        for (int x = x1; x <= x2; x++) {
            set_pixel(x, y1, val);
            set_pixel(x, y2, val);
        }
        for (int y = y1; y <= y2; y++) {
            set_pixel(x1, y, val);
            set_pixel(x2, y, val);
        }
    };

    // 电池外框宽度（不含电池头）
    int body_w = w - head_w;

    uint8_t black = 0x00;
    uint8_t white = 0xFF;

    if (low_battery) {
        // === 低电量反白模式 ===
        // 填充整个背景为黑色
        draw_rect_filled(0, 0, w - 1, h - 1, black);

        // 绘制白色格框
        for (int cell = 0; cell < 3; cell++) {
            int cx = pad + cell * (cell_w + gap);
            int cy = pad;
            int cx2 = cx + cell_w - 1;
            int cy2 = h - pad - 1;

            if (cell < filled_cells) {
                // 已填充格：保持白色（什么都不画）
            } else {
                // 空格：填充黑色
                draw_rect_filled(cx, cy, cx2, cy2, black);
            }
            // 格框边线（白色）
            draw_rect_outline(cx, cy, cx2, cy2, white);
        }

        // 外框边线（白色）
        draw_rect_outline(0, 1, body_w - 1, h - 2, white);
    } else {
        // === 正常模式 ===
        // 绘制外框边线（黑色）
        draw_rect_outline(0, 1, body_w - 1, h - 2, black);

        // 电池头（右侧小凸起）
        draw_rect_outline(body_w, 3, w - 1, h - 4, black);

        // 绘制内部格框
        for (int cell = 0; cell < 3; cell++) {
            int cx = pad + cell * (cell_w + gap);
            int cy = pad;
            int cx2 = cx + cell_w - 1;
            int cy2 = h - pad - 1;

            // 格框边线（黑色）
            draw_rect_outline(cx, cy, cx2, cy2, black);

            if (cell < filled_cells) {
                // 已填充格：填充黑色
                draw_rect_filled(cx + 1, cy + 1, cx2 - 1, cy2 - 1, black);
            }
        }
    }

    // 充电指示：绘制闪电符号
    if (charging) {
        int cx = body_w / 2;
        int cy = h / 2;
        uint8_t color = low_battery ? white : black;

        // 简化闪电：竖线 + 斜线
        for (int y = cy - 3; y <= cy + 3; y++) {
            set_pixel(cx, y, color);
        }
        for (int i = -2; i <= 2; i++) {
            set_pixel(cx + i, cy + i, color);
        }
    }
}

}  // namespace ui