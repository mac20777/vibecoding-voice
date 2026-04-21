# BMI270 玩具运动检测示例

## 概述

本示例演示如何使用 BMI270 传感器进行玩具运动检测和手势识别。

## 功能特点

- **多轴检测**：支持 X、Y、Z 三个运动方向
- **低功耗**：BMI270 INT 引脚触发 GPIO 中断，支持实现硬件级手势检测触发，连接 RTC GPIO 可实现 deepsleep 手势唤醒
- **实时处理**：低延迟手势识别响应
- **玩具运动优化**：专门针对玩具运动检测的配置

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

以下参数可在 `toy_motion_main.c` 中调整：

```c
// 玩具运动检测灵敏度阈值
uint16_t toy_motion_threshold = 0x0800;  // 默认阈值

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

该示例包含专门针对玩具运动优化的函数：

**1. `adjust_toy_motion_config()`**
- **作用**：优化玩具运动检测配置
- **功能**：设置玩具运动阈值以获得最佳灵敏度
- **使用**：在初始化时调用以配置检测参数
- **寄存器**：修改玩具运动检测寄存器

**2. `bmi270_toy_enable_toy_motion_int()`**
- **作用**：启用玩具运动中断功能
- **功能**：配置玩具运动检测的中断设置
- **使用**：调用以启用玩具运动中断检测
- **逻辑**：
  - 启用加速度计和陀螺仪传感器
  - 配置中断映射
  - 设置玩具运动检测参数

#### 可调参数

您可以根据不同的灵敏度需求修改这些函数：

```c
// 在 adjust_toy_motion_config() 中
// 投掷手势检测参数（针对灵敏度优化）
uint16_t throw_min_duration = 0x04;    // 最小持续时间，更敏感的检测
uint16_t throw_up_duration = 0x02;     // 向上投掷持续时间，更轻的投掷检测
uint16_t low_g_exit_duration = 0x01;   // 低G退出持续时间，更轻的摔落检测
uint16_t quiet_time_duration = 0x02;   // 静默时间持续时间，更敏感的接住检测

// 碰撞检测参数
uint16_t slope_thres = 0x0800;  // 斜率阈值，更敏感的碰撞检测

// 在 bmi270_toy_enable_toy_motion_int() 中
uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_GYRO };  // 传感器配置
```

#### 参数说明

| 参数 | 当前值 | 作用 | 影响 |
|------|--------|------|------|
| **throw_min_duration** | 0x04 | 最小投掷持续时间 | 更低 = 更敏感的检测 |
| **throw_up_duration** | 0x02 | 向上投掷手势持续时间 | 更低 = 更轻的投掷检测 |
| **low_g_exit_duration** | 0x01 | 低G退出持续时间 | 更低 = 更轻的摔落检测 |
| **quiet_time_duration** | 0x02 | 静默时间持续时间 | 更低 = 更敏感的接住检测 |
| **slope_thres** | 0x0800 | 碰撞检测斜率阈值 | 更低 = 更敏感的碰撞检测 |

#### 手势检测优化

该函数针对不同的玩具运动手势进行优化：

- **向上投掷**：通过 `throw_up_duration` 参数优化
- **向下投掷**：通过 `low_g_exit_duration` 参数增强
- **投掷接住**：通过 `quiet_time_duration` 参数改进
- **碰撞检测**：通过 `slope_thres` 参数调优

## 使用方法

1. **编译和烧录**：
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **运行测试**：
   - 触发玩具运动检测：拿起、放下、抛起、落下、抛起后接住
   - 观察串口输出中的检测结果
   - 根据实际需要调整灵敏度

## 输出示例

```
I (1378) bmi270_api: BMI270 sensor created successfully
I (1388) MAIN: Toy motion feature enabled, result: 0
I (1488) MAIN: Move the sensor to get toy motion interrupt...
I (15598) MAIN: Toy motion detected - Raw data: 0x15, Gesture type: 0x05
I (15598) MAIN: *** THROW CATCH generated ***
I (18798) MAIN: Toy motion detected - Raw data: 0x0D, Gesture type: 0x03
I (18798) MAIN: *** THROW UP generated ***
I (18998) MAIN: Toy motion detected - Raw data: 0x11, Gesture type: 0x04
I (18998) MAIN: *** THROW DOWN generated ***
I (21498) MAIN: Toy motion detected - Raw data: 0x0D, Gesture type: 0x03
I (21498) MAIN: *** THROW UP generated ***
I (21698) MAIN: Toy motion detected - Raw data: 0x11, Gesture type: 0x04
I (21698) MAIN: *** THROW DOWN generated ***
I (27998) MAIN: Toy motion detected - Raw data: 0x09, Gesture type: 0x02
I (27998) MAIN: *** PUT DOWN generated ***
I (29598) MAIN: Toy motion detected - Raw data: 0x05, Gesture type: 0x01
```