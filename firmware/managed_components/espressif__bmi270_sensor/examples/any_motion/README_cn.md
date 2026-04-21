# BMI270 任意运动检测示例

## 概述

本示例演示如何使用 BMI270 传感器进行任意运动检测。

## 功能特点

- **多轴检测**：支持任意运动方向
- **低功耗**：BMI270 INT 引脚触发 GPIO 中断，支持实现硬件级运动检测触发，连接 RTC GPIO 可实现 deepsleep 运动唤醒
- **实时处理**：低延迟识别响应
- **任意运动优化**：专门针对任意运动检测的配置

## 硬件要求

- ESP32 开发板：
  - ESP-SPOT-C5
  - ESP-SPOT-S3
  - ESP-ASTOM-S3
  - ESP-ECHOEAR-S3
  - 自定义开发板
- BMI270 传感器

## 配置说明

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
   配置 I2C 和中断引脚：
   - I2C SCL Pin
   - I2C SDA Pin
   - INT Pin

### 代码配置

以下参数可在 `any_motion_main.c` 中调整：

```c
// 任意运动检测灵敏度阈值
uint16_t any_motion_threshold = 0x0800;  // 默认阈值

// 加速度计配置
config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_200HZ;    // 200Hz 采样率
config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_16G;  // ±16G 量程
config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // 带宽参数
config[BMI2_ACCEL].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE; // 滤波器性能

// 陀螺仪配置
config[BMI2_GYRO].cfg.gyr.odr = BMI2_GYR_ODR_200HZ;     // 200Hz 采样率
config[BMI2_GYRO].cfg.gyr.range = BMI2_GYR_RANGE_2000;   // ±2000dps 量程
config[BMI2_GYRO].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;   // 带宽参数
config[BMI2_GYRO].cfg.gyr.noise_perf = BMI2_POWER_OPT_MODE; // 噪声性能
config[BMI2_GYRO].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE; // 滤波器性能
```

#### 配置函数

该示例包含专门针对任意运动优化的函数：

**1. `set_accel_gyro_config()`**
- **作用**：配置加速度计和陀螺仪参数
- **功能**：设置传感器配置用于运动检测
- **使用**：在初始化时调用以配置传感器参数
- **寄存器**：修改传感器配置寄存器

**2. `bmi270_toy_enable_any_motion_int()`**
- **作用**：启用任意运动中断功能
- **功能**：配置任意运动检测的中断设置
- **使用**：调用以启用任意运动中断检测
- **逻辑**：
  - 启用加速度计和陀螺仪传感器
  - 配置中断映射
  - 设置任意运动检测参数

#### 可调参数

您可以根据不同的灵敏度需求修改这些函数：

```c
// 在 set_accel_gyro_config() 中
// 传感器配置参数
config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_200HZ;    // 采样率
config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_16G;  // 测量范围
config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // 带宽参数

// 在 bmi270_toy_enable_any_motion_int() 中
uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_GYRO };  // 传感器配置
```

## 使用方法

1. **编译和烧录**：
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **运行测试**：
   - 移动或摇晃传感器以触发任意运动检测
   - 观察串口输出中的检测结果
   - 根据实际需要调整灵敏度

## 输出示例

```
I (1378) bmi270_api: BMI270 sensor created successfully
I (1388) MAIN: Any motion feature enabled, result: 0
I (1488) MAIN: Move the sensor to get any motion interrupt...
I (6198) MAIN: Any motion detected!
I (6198) MAIN: Waiting 3 seconds before next detection...
I (9198) MAIN: Ready for next any motion detection...
I (11008) MAIN: Any motion detected!
I (11008) MAIN: Waiting 3 seconds before next detection...
I (14018) MAIN: Ready for next any motion detection...
```