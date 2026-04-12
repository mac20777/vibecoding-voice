#include "lifebar_page.h"
#include <esp_log.h>

// 外部字体声明（支持中文）
extern const lv_font_t SourceHanSansSC_Regular_slim;
extern const lv_font_t font_zectrix_48_1;

namespace ui {

constexpr char kTag[] = "LifeBarPage";

LifeBarPage::LifeBarPage(lv_obj_t* parent) {
    // 创建容器
    container_ = lv_obj_create(parent);
    lv_obj_set_size(container_, LV_PCT(100), LV_PCT(100));
    lv_obj_set_style_bg_color(container_, lv_color_white(), 0);
    lv_obj_set_style_pad_all(container_, 16, 0);

    // Flex 布局：垂直居中
    lv_obj_set_flex_flow(container_, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(container_, LV_FLEX_ALIGN_SPACE_EVENLY, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    // 年龄标签
    age_label_ = lv_label_create(container_);
    lv_label_set_text(age_label_, "年龄: -- 岁");

    // 目标标签
    goal_label_ = lv_label_create(container_);
    lv_label_set_text(goal_label_, "目标: --");

    // 进度条
    progress_bar_ = lv_bar_create(container_);
    lv_obj_set_size(progress_bar_, 200, 10);
    lv_bar_set_value(progress_bar_, 0, LV_ANIM_OFF);
    lv_obj_set_style_bg_color(progress_bar_, lv_color_black(), LV_PART_INDICATOR);

    // 进度百分比
    progress_label_ = lv_label_create(container_);
    lv_label_set_text(progress_label_, "进度: 0%");

    ESP_LOGI(kTag, "LifeBar page created");
}

LifeBarPage::~LifeBarPage() {
    // 子控件会随 container 删除而删除
}

void LifeBarPage::UpdateData(const LifeBarData& data) {
    if (age_label_) lv_label_set_text_fmt(age_label_, "年龄: %s 岁", data.age.c_str());
    if (goal_label_) lv_label_set_text_fmt(goal_label_, "目标: %s", data.goal.c_str());
    if (progress_label_) lv_label_set_text_fmt(progress_label_, "进度: %s", data.progress.c_str());

    // 设置进度条值
    if (progress_bar_) {
        int value = atoi(data.progress.c_str());
        lv_bar_set_value(progress_bar_, value, LV_ANIM_OFF);
    }
}

void LifeBarPage::Refresh() {
    // LVGL 会自动处理刷新
}

}  // namespace ui