#include "chat_page.h"
#include <esp_log.h>

// 外部字体声明（支持中文）
extern const lv_font_t font_zectrix_16_1;
extern const lv_font_t SourceHanSansSC_Regular_slim;

namespace ui {

constexpr char kTag[] = "ChatPage";

ChatPage::ChatPage(lv_obj_t* parent) {
    // 创建 Flex 容器（垂直布局）
    container_ = lv_obj_create(parent);
    lv_obj_set_size(container_, LV_PCT(100), LV_PCT(100));
    lv_obj_set_style_bg_color(container_, lv_color_white(), 0);
    lv_obj_set_style_pad_all(container_, 8, 0);

    // Flex 布局：垂直，从底部开始（新消息在下方）
    lv_obj_set_flex_flow(container_, LV_FLEX_FLOW_COLUMN_REVERSE);
    lv_obj_set_flex_align(container_, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    ESP_LOGI(kTag, "Chat page created with Flex layout");
}

ChatPage::~ChatPage() {
    // 气泡会随 container 删除而删除
}

void ChatPage::Clear() {
    // 删除所有气泡
    for (lv_obj_t* bubble : bubbles_) {
        lv_obj_delete(bubble);
    }
    bubbles_.clear();

    if (status_label_) {
        lv_obj_delete(status_label_);
        status_label_ = nullptr;
    }
}

void ChatPage::AddMessage(const std::string& text, ChatRole role) {
    // 先隐藏状态提示
    HideStatus();

    // 创建气泡
    lv_obj_t* bubble = CreateBubble(text, role);
    ApplyBubbleStyle(bubble, role);

    // 添加到容器（Flex 会自动布局）
    lv_obj_set_parent(bubble, container_);
    bubbles_.push_back(bubble);

    // 滚动到底部显示新消息
    lv_obj_scroll_to_view(bubble, LV_ANIM_OFF);
}

void ChatPage::ShowStatus(const std::string& status, ChatRole role) {
    if (!status_label_) {
        status_label_ = CreateBubble("", role);
        ApplyBubbleStyle(status_label_, role);
        lv_obj_set_parent(status_label_, container_);
    }

    lv_obj_t* label = lv_obj_get_child(status_label_, 0);
    if (label) {
        lv_label_set_text(label, status.c_str());
    }
    lv_obj_remove_flag(status_label_, LV_OBJ_FLAG_HIDDEN);
}

void ChatPage::HideStatus() {
    if (status_label_) {
        lv_obj_add_flag(status_label_, LV_OBJ_FLAG_HIDDEN);
    }
}

void ChatPage::Refresh() {
    // LVGL 会自动处理刷新
}

lv_obj_t* ChatPage::CreateBubble(const std::string& text, ChatRole role) {
    // 创建气泡容器
    lv_obj_t* bubble = lv_obj_create(nullptr);
    lv_obj_set_size(bubble, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_style_radius(bubble, 8, 0);  // 圆角

    // 创建文本标签
    lv_obj_t* label = lv_label_create(bubble);
    lv_label_set_text(label, text.c_str());
    lv_obj_set_style_text_font(label, &SourceHanSansSC_Regular_slim, 0);
    lv_obj_align(label, LV_ALIGN_CENTER, 0, 0);

    return bubble;
}

void ChatPage::ApplyBubbleStyle(lv_obj_t* bubble, ChatRole role) {
    switch (role) {
        case ChatRole::User: {
            // 用户消息：黑底白字，右对齐
            lv_obj_set_style_bg_color(bubble, lv_color_black(), 0);
            lv_obj_set_style_bg_opa(bubble, LV_OPA_COVER, 0);
            lv_obj_set_style_border_width(bubble, 0, 0);
            // 文字白色
            lv_obj_t* label = lv_obj_get_child(bubble, 0);
            if (label) {
                lv_obj_set_style_text_color(label, lv_color_white(), 0);
            }
            // 设置交叉轴右对齐（在 Flex 布局中）
            lv_obj_set_style_flex_cross_place(bubble, LV_FLEX_ALIGN_END, 0);
            break;
        }

        case ChatRole::AI:
            // AI 回复：白底黑框，左对齐
            lv_obj_set_style_bg_color(bubble, lv_color_white(), 0);
            lv_obj_set_style_bg_opa(bubble, LV_OPA_COVER, 0);
            lv_obj_set_style_border_color(bubble, lv_color_black(), 0);
            lv_obj_set_style_border_width(bubble, 1, 0);
            // 设置交叉轴左对齐（默认，但明确指定）
            lv_obj_set_style_flex_cross_place(bubble, LV_FLEX_ALIGN_START, 0);
            break;

        case ChatRole::System:
            // 系统提示：白底无框，居中
            lv_obj_set_style_bg_color(bubble, lv_color_white(), 0);
            lv_obj_set_style_bg_opa(bubble, LV_OPA_TRANSP, 0);
            lv_obj_set_style_border_width(bubble, 0, 0);
            lv_obj_set_style_flex_cross_place(bubble, LV_FLEX_ALIGN_CENTER, 0);
            break;
    }
}

}  // namespace ui