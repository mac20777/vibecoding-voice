#include "status_bar.h"
#include <esp_log.h>
#include <cstring>
#include <cstdio>

extern const lv_font_t SourceHanSansSC_Regular_slim;
extern const lv_font_t font_zectrix_16_1;

namespace ui {

constexpr char kTag[] = "StatusBar";

// 电池图标尺寸配置
constexpr int kBatteryWidth = 24;    // 电池总宽度
constexpr int kBatteryHeight = 12;   // 电池高度
constexpr int kCellWidth = 6;        // 每节宽度 (3节)
constexpr int kCellGap = 2;          // 节间距
constexpr int kCellPadding = 2;      // 内边距

// 静态 Canvas 缓冲区 (L8 格式，每像素 1 字节)
static uint8_t battery_buf[kBatteryWidth * kBatteryHeight];

StatusBar::StatusBar(lv_obj_t* parent) {
    // 创建状态栏容器（固定顶部）
    container_ = lv_obj_create(parent);
    lv_obj_set_size(container_, LV_PCT(100), kHeight);
    lv_obj_set_style_bg_color(container_, lv_color_white(), 0);
    lv_obj_set_style_bg_opa(container_, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(container_, 0, 0);
    lv_obj_set_style_pad_all(container_, 4, 0);
    lv_obj_set_style_radius(container_, 0, 0);
    lv_obj_clear_flag(container_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_align(container_, LV_ALIGN_TOP_MID, 0, 0);

    // WiFi 图标（左侧）- 使用 LVGL 内置符号
    wifi_icon_ = lv_label_create(container_);
    lv_obj_set_pos(wifi_icon_, 8, 8);
    lv_obj_set_style_text_font(wifi_icon_, &font_zectrix_16_1, 0);
    lv_obj_set_style_text_color(wifi_icon_, lv_color_black(), 0);
    lv_label_set_text(wifi_icon_, LV_SYMBOL_WIFI);

    // 服务状态文字（WiFi 图标右侧）
    status_text_ = lv_label_create(container_);
    lv_obj_set_pos(status_text_, 28, 8);
    lv_obj_set_style_text_font(status_text_, &SourceHanSansSC_Regular_slim, 0);
    lv_obj_set_style_text_color(status_text_, lv_color_black(), 0);
    lv_label_set_text(status_text_, "");

    // 页面标题（居中）
    title_label_ = lv_label_create(container_);
    lv_obj_set_style_text_font(title_label_, &SourceHanSansSC_Regular_slim, 0);
    lv_obj_set_style_text_color(title_label_, lv_color_black(), 0);
    lv_label_set_text(title_label_, "对话");
    lv_obj_align(title_label_, LV_ALIGN_CENTER, 0, 0);

    // 电池图标 Canvas（右侧）- 3 节横向电池
    battery_canvas_ = lv_canvas_create(container_);
    lv_obj_set_pos(battery_canvas_, 352, 6);
    lv_canvas_set_buffer(battery_canvas_, battery_buf, kBatteryWidth, kBatteryHeight, LV_COLOR_FORMAT_L8);
    lv_canvas_fill_bg(battery_canvas_, lv_color_white(), LV_OPA_COVER);

    // 电池百分比文字（Canvas 右侧）
    battery_label_ = lv_label_create(container_);
    lv_obj_set_pos(battery_label_, 380, 8);
    lv_obj_set_style_text_font(battery_label_, &SourceHanSansSC_Regular_slim, 0);
    lv_obj_set_style_text_color(battery_label_, lv_color_black(), 0);
    lv_label_set_text(battery_label_, "--");

    ESP_LOGI(kTag, "Status bar created with WiFi icon and battery canvas");
}

void StatusBar::DrawBatteryIcon(int level, bool charging) {
    if (!battery_canvas_) return;

    // 清空 Canvas
    lv_canvas_fill_bg(battery_canvas_, lv_color_white(), LV_OPA_COVER);

    // 初始化 Canvas layer 用于绘制 (LVGL v9 API)
    lv_layer_t layer;
    lv_canvas_init_layer(battery_canvas_, &layer);

    // 低电量警告 (<20%) 使用反白样式
    bool low_battery = (level >= 0 && level < 20);

    // 绘制外框边框
    lv_draw_border_dsc_t border_dsc;
    lv_draw_border_dsc_init(&border_dsc);
    border_dsc.color = lv_color_black();
    border_dsc.width = 1;
    border_dsc.opa = LV_OPA_COVER;
    border_dsc.radius = 1;
    border_dsc.side = LV_BORDER_SIDE_FULL;

    lv_area_t border_area;
    lv_area_set(&border_area, 0, 0, kBatteryWidth - 3, kBatteryHeight - 1);
    lv_draw_border(&layer, &border_dsc, &border_area);

    // 低电量时填充黑色背景
    if (low_battery) {
        lv_draw_fill_dsc_t bg_dsc;
        lv_draw_fill_dsc_init(&bg_dsc);
        bg_dsc.color = lv_color_black();
        bg_dsc.opa = LV_OPA_COVER;
        bg_dsc.radius = 1;

        lv_area_t bg_area;
        lv_area_set(&bg_area, 1, 1, kBatteryWidth - 4, kBatteryHeight - 2);
        lv_draw_fill(&layer, &bg_dsc, &bg_area);
    }

    // 计算填充的节数
    int filled_cells = 0;
    if (level >= 0) {
        if (level <= 33) filled_cells = 1;
        else if (level <= 66) filled_cells = 2;
        else filled_cells = 3;
    }

    // 绘制内部填充的节
    lv_draw_fill_dsc_t cell_dsc;
    lv_draw_fill_dsc_init(&cell_dsc);
    cell_dsc.color = low_battery ? lv_color_white() : lv_color_black();
    cell_dsc.opa = LV_OPA_COVER;
    cell_dsc.radius = 0;

    // 每节的位置计算 (从左到右)
    int cell_x_start = kCellPadding;
    int cell_y_start = kCellPadding;
    int cell_h = kBatteryHeight - 2 * kCellPadding;

    for (int i = 0; i < filled_cells; i++) {
        int cell_x = cell_x_start + i * (kCellWidth + kCellGap);
        lv_area_t cell_area;
        lv_area_set(&cell_area, cell_x, cell_y_start, cell_x + kCellWidth - 1, cell_y_start + cell_h - 1);
        lv_draw_fill(&layer, &cell_dsc, &cell_area);
    }

    // 充电状态：在电池右侧画一个小的充电头凸起
    if (charging) {
        lv_draw_fill_dsc_t charge_dsc;
        lv_draw_fill_dsc_init(&charge_dsc);
        charge_dsc.color = lv_color_black();
        charge_dsc.opa = LV_OPA_COVER;

        lv_area_t charge_area;
        lv_area_set(&charge_area, kBatteryWidth - 2, 3, kBatteryWidth - 1, kBatteryHeight - 4);
        lv_draw_fill(&layer, &charge_dsc, &charge_area);
    }

    // 完成绘制
    lv_canvas_finish_layer(battery_canvas_, &layer);
}

void StatusBar::Update(const StatusBarData& data) {
    // 更新 WiFi 图标：实心（连接）/ 叉号（断开）
    if (wifi_icon_) {
        if (data.wifi_connected) {
            lv_obj_set_style_text_color(wifi_icon_, lv_color_black(), 0);
            lv_label_set_text(wifi_icon_, LV_SYMBOL_WIFI);  // 实心 WiFi 图标
        } else {
            lv_obj_set_style_text_color(wifi_icon_, lv_color_make(0x80, 0x80, 0x80), 0);
            lv_label_set_text(wifi_icon_, LV_SYMBOL_CLOSE);  // 叉号
        }
    }

    // 更新服务状态文字：Online / No Srv / 空
    if (status_text_) {
        if (!data.wifi_connected) {
            lv_label_set_text(status_text_, "WiFi断开");
            lv_obj_set_style_text_color(status_text_, lv_color_make(0x80, 0x80, 0x80), 0);
        } else if (!data.server_connected) {
            lv_label_set_text(status_text_, "No Srv");
            lv_obj_set_style_text_color(status_text_, lv_color_make(0x80, 0x80, 0x80), 0);
        } else {
            lv_label_set_text(status_text_, "Online");
            lv_obj_set_style_text_color(status_text_, lv_color_black(), 0);
        }
    }

    // 更新页面标题
    if (title_label_ && !data.page_title.empty()) {
        lv_label_set_text(title_label_, data.page_title.c_str());
    }

    // 更新电池图标和百分比
    DrawBatteryIcon(data.battery_level, data.battery_charging);

    if (battery_label_) {
        char buf[8];
        if (data.battery_level >= 0 && data.battery_level <= 100) {
            snprintf(buf, sizeof(buf), "%d%s", data.battery_level,
                     data.battery_charging ? "+" : "");
        } else {
            snprintf(buf, sizeof(buf), "--");
        }
        lv_label_set_text(battery_label_, buf);
    }
}

}  // namespace ui