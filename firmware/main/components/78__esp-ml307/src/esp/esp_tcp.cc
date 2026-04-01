#include "esp_tcp.h"

#include <esp_log.h>
#include <unistd.h>
#include <cstring>
#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <errno.h>
#include <sys/select.h>
#include <sys/socket.h>

static const char *TAG = "EspTcp";
static constexpr int kConnectTimeoutMs = 1500;

EspTcp::EspTcp() {
    event_group_ = xEventGroupCreate();
}

EspTcp::~EspTcp() {
    Disconnect();

    if (event_group_ != nullptr) {
        vEventGroupDelete(event_group_);
        event_group_ = nullptr;
    }
}

bool EspTcp::Connect(const std::string& host, int port) {
    // 确保先断开已有连接
    if (connected_) {
        Disconnect();
    }

    char port_text[8];
    snprintf(port_text, sizeof(port_text), "%d", port);

    addrinfo hints = {};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    addrinfo* server = nullptr;
    int resolve_ret = getaddrinfo(host.c_str(), port_text, &hints, &server);
    if (resolve_ret != 0 || server == nullptr) {
        last_error_ = resolve_ret != 0 ? resolve_ret : EHOSTUNREACH;
        ESP_LOGE(TAG, "Failed to resolve %s:%d, code=%d", host.c_str(), port, last_error_);
        return false;
    }

    tcp_fd_ = socket(server->ai_family, server->ai_socktype, server->ai_protocol);
    if (tcp_fd_ < 0) {
        last_error_ = errno;
        ESP_LOGE(TAG, "Failed to create socket");
        freeaddrinfo(server);
        return false;
    }

    const int original_flags = fcntl(tcp_fd_, F_GETFL, 0);
    if (original_flags >= 0) {
        fcntl(tcp_fd_, F_SETFL, original_flags | O_NONBLOCK);
    }

    int ret = connect(tcp_fd_, server->ai_addr, server->ai_addrlen);
    if (ret < 0 && errno != EINPROGRESS && errno != EWOULDBLOCK) {
        last_error_ = errno;
        ESP_LOGE(TAG, "Failed to connect to %s:%d, code=0x%x", host.c_str(), port, last_error_);
        freeaddrinfo(server);
        close(tcp_fd_);
        tcp_fd_ = -1;
        return false;
    }

    if (ret < 0) {
        fd_set write_fds;
        FD_ZERO(&write_fds);
        FD_SET(tcp_fd_, &write_fds);

        timeval timeout = {};
        timeout.tv_sec = kConnectTimeoutMs / 1000;
        timeout.tv_usec = (kConnectTimeoutMs % 1000) * 1000;

        ret = select(tcp_fd_ + 1, nullptr, &write_fds, nullptr, &timeout);
        if (ret <= 0) {
            last_error_ = (ret == 0) ? ETIMEDOUT : errno;
            ESP_LOGE(TAG, "Connect timeout to %s:%d, code=0x%x", host.c_str(), port, last_error_);
            freeaddrinfo(server);
            close(tcp_fd_);
            tcp_fd_ = -1;
            return false;
        }

        int socket_error = 0;
        socklen_t socket_error_len = sizeof(socket_error);
        if (getsockopt(tcp_fd_, SOL_SOCKET, SO_ERROR, &socket_error, &socket_error_len) < 0) {
            last_error_ = errno;
            ESP_LOGE(TAG, "Failed to read socket error for %s:%d, code=0x%x", host.c_str(), port, last_error_);
            freeaddrinfo(server);
            close(tcp_fd_);
            tcp_fd_ = -1;
            return false;
        }

        if (socket_error != 0) {
            last_error_ = socket_error;
            ESP_LOGE(TAG, "Failed to connect to %s:%d, code=0x%x", host.c_str(), port, last_error_);
            freeaddrinfo(server);
            close(tcp_fd_);
            tcp_fd_ = -1;
            return false;
        }
    }

    if (original_flags >= 0) {
        fcntl(tcp_fd_, F_SETFL, original_flags);
    }
    freeaddrinfo(server);

    connected_ = true;

    xEventGroupClearBits(event_group_, ESP_TCP_EVENT_RECEIVE_TASK_EXIT);
    xTaskCreate([](void* arg) {
        EspTcp* tcp = (EspTcp*)arg;
        tcp->ReceiveTask();
        xEventGroupSetBits(tcp->event_group_, ESP_TCP_EVENT_RECEIVE_TASK_EXIT);
        vTaskDelete(NULL);
    }, "tcp_receive", 4096, this, 1, &receive_task_handle_);
    return true;
}

void EspTcp::Disconnect() {
    // 如果已经断开，直接返回
    if (!connected_) {
        return;
    }

    // 主动断开，需要等待接收任务退出
    DoDisconnect(true);
}

void EspTcp::DoDisconnect(bool wait_for_task) {
    connected_ = false;

    if (tcp_fd_ != -1) {
        close(tcp_fd_);
        tcp_fd_ = -1;

        // 只有主动断开时才需要等待接收任务退出
        // 被动断开时，当前就是接收任务，不需要等待
        if (wait_for_task) {
            auto bits = xEventGroupWaitBits(event_group_, ESP_TCP_EVENT_RECEIVE_TASK_EXIT, pdFALSE, pdFALSE, pdMS_TO_TICKS(10000));
            if (!(bits & ESP_TCP_EVENT_RECEIVE_TASK_EXIT)) {
                ESP_LOGE(TAG, "Failed to wait for receive task exit");
            }
        }
    }

    // 断开连接时触发断开回调
    if (disconnect_callback_) {
        disconnect_callback_();
    }
}

int EspTcp::Send(const std::string& data) {
    if (!connected_) {
        ESP_LOGE(TAG, "Not connected");
        return -1;
    }

    size_t total_sent = 0;
    size_t data_size = data.size();
    const char* data_ptr = data.data();

    while (total_sent < data_size) {
        int ret = send(tcp_fd_, data_ptr + total_sent, data_size - total_sent, 0);

        if (ret <= 0) {
            ESP_LOGE(TAG, "Send failed: ret=%d, errno=%d", ret, errno);
            return ret;
        }

        total_sent += ret;
    }

    return total_sent;
}

void EspTcp::ReceiveTask() {
    std::string data;
    while (connected_) {
        data.resize(1500);
        int ret = recv(tcp_fd_, data.data(), data.size(), 0);
        if (ret <= 0) {
            if (ret < 0) {
                ESP_LOGE(TAG, "TCP receive failed: %d", ret);
            }
            // 被动断开，不需要等待接收任务退出（当前就是接收任务）
            DoDisconnect(false);
            break;
        }

        if (stream_callback_) {
            data.resize(ret);
            stream_callback_(data);
        }
    }
}

int EspTcp::GetLastError() {
    return last_error_;
}
