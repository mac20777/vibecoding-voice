# BMI270 Push in Air Detection Example

## Overview

This example demonstrates how to use the BMI270 sensor for push gesture detection in the air.

## Features

- **Multi-axis Detection**: Supports X, Y, Z three push directions
- **Low Power**: BMI270 INT pin triggers GPIO interrupt for hardware-level gesture detection, connecting to RTC GPIO enables deep sleep gesture wake-up
- **Real-time Processing**: Low-latency gesture recognition response

## Hardware Requirements

- ESP32 development board:
  - ESP-SPOT-C5
  - ESP-SPOT-S3
  - ESP-ASTOM-S3
  - ESP-ECHOEAR-S3
  - Custom development board
- BMI270 sensor

## Configuration

### Menuconfig Configuration

1. **Board Selection**:
   ```
   Component config -> BMI270 Sensor -> Board Selection
   ```
   Select the corresponding development board model

2. **Custom Pin Configuration**:
   ```
   Component config -> BMI270 Sensor -> Custom Pin Configuration
   ```
   Configure I2C pins:
   - I2C SCL Pin
   - I2C SDA Pin
   - INT Pin

### Code Configuration

The following parameters can be adjusted in `main.c`:

```c
// High-g threshold for push detection sensitivity
uint16_t high_g_threshold = 0x0800;  // Default threshold

// Accelerometer configuration
config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_400HZ;    // 400Hz sampling rate
config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_8G;   // ±8G range
config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // Bandwidth parameter
config[BMI2_ACCEL].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE; // Filter performance

// Gyroscope configuration  
config[BMI2_GYRO].cfg.gyr.odr = BMI2_GYR_ODR_400HZ;     // 400Hz sampling rate
config[BMI2_GYRO].cfg.gyr.range = BMI2_GYR_RANGE_1000;  // ±1000dps range
config[BMI2_GYRO].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;   // Bandwidth parameter
config[BMI2_GYRO].cfg.gyr.noise_perf = BMI2_POWER_OPT_MODE; // Noise performance
config[BMI2_GYRO].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE; // Filter performance
```

## Usage

1. **Build and Flash**:
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **Run Test**:
   - Hold the sensor and perform push gestures in the air
   - Observe the detection results in serial output
   - Adjust sensitivity according to actual needs

## Output Example

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
