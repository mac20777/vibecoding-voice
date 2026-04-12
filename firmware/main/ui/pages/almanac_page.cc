#include "almanac_page.h"
#include <esp_log.h>

// 外部字体声明（支持中文）
extern const lv_font_t SourceHanSansSC_Regular_slim;

namespace ui {

constexpr char kTag[] = "AlmanacPage";

AlmanacPage::AlmanacPage(lv_obj_t* parent) {
    // 创建容器
    container_ = lv_obj_create(parent);
    lv_obj_set_size(container_, LV_PCT(100), LV_PCT(100));
    lv_obj_set_style_bg_color(container_, lv_color_white(), 0);
    lv_obj_set_style_pad_all(container_, 8, 0);

    // Flex 布局：垂直
    lv_obj_set_flex_flow(container_, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(container_, LV_FLEX_ALIGN_SPACE_EVENLY, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    // 日期（阳历）
    date_label_ = lv_label_create(container_);
    lv_label_set_text(date_label_, "阳历: --");

    // 农历日期
    lunar_label_ = lv_label_create(container_);
    lv_label_set_text(lunar_label_, "农历: --");

    // 宜
    suit_label_ = lv_label_create(container_);
    lv_label_set_text(suit_label_, "宜: --");

    // 忌
    avoid_label_ = lv_label_create(container_);
    lv_label_set_text(avoid_label_, "忌: --");

    // 吉时
    auspicious_label_ = lv_label_create(container_);
    lv_label_set_text(auspicious_label_, "吉时: --");

    ESP_LOGI(kTag, "Almanac page created");
}

AlmanacPage::~AlmanacPage() {
    // 子控件会随 container 删除而删除
}

void AlmanacPage::UpdateData(const AlmanacData& data) {
    if (date_label_) lv_label_set_text_fmt(date_label_, "阳历: %s", data.date.c_str());
    if (lunar_label_) lv_label_set_text_fmt(lunar_label_, "农历: %s", data.lunar_date.c_str());
    if (suit_label_) lv_label_set_text_fmt(suit_label_, "宜: %s", data.suit.c_str());
    if (avoid_label_) lv_label_set_text_fmt(avoid_label_, "忌: %s", data.avoid.c_str());
    if (auspicious_label_) lv_label_set_text_fmt(auspicious_label_, "吉时: %s", data.auspicious.c_str());
}

void AlmanacPage::Refresh() {
    // LVGL 会自动处理刷新
}

}  // namespace ui