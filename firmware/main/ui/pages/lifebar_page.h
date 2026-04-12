#ifndef LIFEBAR_PAGE_H
#define LIFEBAR_PAGE_H

#include <lvgl.h>
#include <string>

namespace ui {

// 人生进度数据
struct LifeBarData {
    std::string age;         // 年龄
    std::string goal;        // 目标
    std::string progress;    // 进度百分比
};

// 人生进度页 - 简化布局
class LifeBarPage {
public:
    LifeBarPage(lv_obj_t* parent);
    ~LifeBarPage();

    // 更新数据
    void UpdateData(const LifeBarData& data);

    // 刷新显示
    void Refresh();

private:
    lv_obj_t* container_ = nullptr;
    lv_obj_t* age_label_ = nullptr;
    lv_obj_t* goal_label_ = nullptr;
    lv_obj_t* progress_bar_ = nullptr;
    lv_obj_t* progress_label_ = nullptr;
};

}  // namespace ui

#endif  // LIFEBAR_PAGE_H