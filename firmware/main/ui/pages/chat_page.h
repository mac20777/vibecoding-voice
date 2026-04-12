#ifndef CHAT_PAGE_H
#define CHAT_PAGE_H

#include <lvgl.h>
#include <string>
#include <vector>

namespace ui {

// 聊天消息角色
enum class ChatRole {
    User,   // 用户消息（右侧，黑底白字）
    AI,     // AI 回复（左侧，白底黑框）
    System  // 系统提示（左侧）
};

// 聊天消息
struct ChatMessage {
    std::string text;
    ChatRole role;
};

// AI 对话页 - Flex 气泡 UI
class ChatPage {
public:
    ChatPage(lv_obj_t* parent);
    ~ChatPage();

    // 清空消息列表
    void Clear();

    // 添加消息（自动滚动到底部）
    void AddMessage(const std::string& text, ChatRole role);

    // 显示临时状态提示（录音/识别/思考）
    void ShowStatus(const std::string& status, ChatRole role);

    // 隐藏状态提示
    void HideStatus();

    // 刷新显示
    void Refresh();

private:
    lv_obj_t* container_ = nullptr;   // Flex 容器
    lv_obj_t* status_label_ = nullptr; // 临时状态提示
    std::vector<lv_obj_t*> bubbles_;   // 消息气泡列表

    // 创建气泡控件
    lv_obj_t* CreateBubble(const std::string& text, ChatRole role);

    // 应用气泡样式
    void ApplyBubbleStyle(lv_obj_t* bubble, ChatRole role);
};

}  // namespace ui

#endif  // CHAT_PAGE_H