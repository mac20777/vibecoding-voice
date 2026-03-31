# BMI270 空中推压检测示例

## 概述

本示例演示如何使用 BMI270 传感器进行空中推压手势检测。

## 功能特点

- **多轴检测**：支持 X、Y、Z 三个推压方向
- **低功耗**：BMI270 INT 引脚触发 GPIO 中断，支持实现硬件级手势检测触发，连接 RTC GPIO 可实现 deepsleep 手势唤醒
- **实时处理**：低延迟手势识别响应

## 硬件要求

- ESP32 开发板：
  - ESP-SPOT-C5
  - ESP-SPOT-S3
  - ESP-ASTOM-S3
  - ESP-ECHOEAR-S3
  - 自定义开发板
- BMI270 传感器

## 配置

### Menuconfig 配置

1. **开发板选择**：
   ```
   Component config -> BMI270 Sensor -> Board Selection
   ```
   选择对应的开发板型号

2. **自定义引脚配置**：
   ```
   Component config -> BMI270 Sensor -> Custom Pin Configuration
   ```
   配置 I2C 引脚：
   - I2C SCL 引脚
   - I2C SDA 引脚
   - INT 中断引脚

### 代码配置

以下参数可在 `main.c` 中调整：

```c
// 推压检测灵敏度的高G阈值
uint16_t high_g_threshold = 0x0800;  // 默认阈值

// 加速度计配置
config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_400HZ;    // 400Hz 采样率
config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_8G;   // ±8G 量程
config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // 带宽参数
config[BMI2_ACCEL].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE; // 滤波器性能

// 陀螺仪配置
config[BMI2_GYRO].cfg.gyr.odr = BMI2_GYR_ODR_400HZ;     // 400Hz 采样率
config[BMI2_GYRO].cfg.gyr.range = BMI2_GYR_RANGE_1000;  // ±1000dps 量程
config[BMI2_GYRO].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;   // 带宽参数
config[BMI2_GYRO].cfg.gyr.noise_perf = BMI2_POWER_OPT_MODE; // 噪声性能
config[BMI2_GYRO].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE; // 滤波器性能
```

## 使用方法

1. **编译和烧录**：
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **运行测试**：
   - 手持传感器进行空中推压手势
   - 观察串口输出中的检测结果
   - 根据实际需要调整灵敏度

## 输出示例

```
I (1378) bmi270_api: BMI270 sensor created successfully
I (1388) MAIN: Push feature enabled, result: 0
I (1488) MAIN: Move the sensor to get push interrupt...
I (6198) MAIN: Push generated!
I (6198) MAIN: Push direction: -z
I (6198) MAIN: Waiting 3 seconds before next detection...
I (9198) MAIN: Ready for next push detection...
I (11008) MAIN: Push generated!
I (11008) MAIN: Push direction: +y
I (11008) MAIN: Waiting 3 seconds before next detection...
```
