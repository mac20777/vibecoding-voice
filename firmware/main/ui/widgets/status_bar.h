#pragma once

#include <lvgl.h>
#include <string>

namespace ui {

struct StatusBarData {
    std::string page_title;
    bool wifi_connected = false;
    bool server_connected = false;
    int battery_level = -1;      // -1 = unknown
    bool battery_charging = false;
};

class StatusBar {
public:
    StatusBar(lv_obj_t* parent);
    ~StatusBar();

    void Update(const StatusBarData& data);
    void Refresh();

    static constexpr int GetHeight() { return 30; }

    // 电池 canvas 尺寸（横向 3 节）
    static constexpr int kBatteryWidth = 30;
    static constexpr int kBatteryHeight = 12;

private:
    lv_obj_t* container_ = nullptr;
    lv_obj_t* wifi_icon_ = nullptr;        // WiFi 图标 label
    lv_obj_t* status_text_ = nullptr;       // 状态文字（离线提示）
    lv_obj_t* title_label_ = nullptr;       // 页面标题
    lv_obj_t* battery_canvas_ = nullptr;    // 电池 canvas（绘制 3 格）
    lv_obj_t* battery_pct_label_ = nullptr; // 百分比文字

    // Canvas 缓冲区（L8 格式，每像素 1 字节）
    static constexpr int kBatteryBufferSize = kBatteryWidth * kBatteryHeight;
    uint8_t battery_buffer_[kBatteryBufferSize];

    // 绘制横向 3 节电池图标
    void DrawBattery3Cell(int level, bool charging);
};

}  // namespace ui