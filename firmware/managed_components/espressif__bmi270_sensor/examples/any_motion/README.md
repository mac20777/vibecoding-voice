# BMI270 Any Motion Detection Example

## Overview

This example demonstrates how to use the BMI270 sensor for any motion detection.

## Features

- **Multi-axis Detection**: Supports X, Y, Z three motion directions
- **Low Power**: BMI270 INT pin triggers GPIO interrupt for hardware-level motion detection, connecting to RTC GPIO enables deep sleep motion wake-up
- **Real-time Processing**: Low-latency motion recognition response
- **Any Motion Optimized**: Specialized configuration for any motion detection

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

### Code Configuration

The following parameters can be adjusted in `any_motion_main.c`:

```c
// Any motion detection parameters
uint16_t any_motion_threshold = 0x0800;  // Default threshold (2048mg)
uint16_t any_motion_duration = 0x02;     // Default duration (40ms)

// Accelerometer configuration
config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_200HZ;    // 200Hz sampling rate
config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_16G;  // ±16G range
config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // Standard averaging
config[BMI2_ACCEL].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE; // Filter performance

// Gyroscope configuration  
config[BMI2_GYRO].cfg.gyr.odr = BMI2_GYR_ODR_200HZ;     // 200Hz sampling rate
config[BMI2_GYRO].cfg.gyr.range = BMI2_GYR_RANGE_2000;   // ±2000dps range
config[BMI2_GYRO].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;   // Standard filtering
config[BMI2_GYRO].cfg.gyr.noise_perf = BMI2_PERF_OPT_MODE; // Noise performance
config[BMI2_GYRO].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE; // Filter performance
```

#### Configuration Functions

The example includes specialized functions for any motion detection:

**1. `set_accel_gyro_config()`**
- **Purpose**: Configures accelerometer and gyroscope parameters
- **Function**: Sets up sensor configuration for motion detection
- **Usage**: Called during initialization to configure sensor parameters
- **Registers**: Modifies sensor configuration registers

**2. `bmi270_toy_enable_any_motion_int()`**
- **Purpose**: Enables any motion interrupt functionality
- **Function**: Configures interrupt settings for any motion detection
- **Usage**: Called to enable any motion interrupt detection
- **Logic**: 
  - Enables accelerometer and gyroscope sensors
  - Configures interrupt mapping
  - Sets up any motion detection parameters

#### Customizable Parameters

You can modify these functions for different sensitivity requirements:

```c
// In set_accel_gyro_config()
// Sensor configuration parameters
config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_200HZ;    // Sampling rate
config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_16G;  // Measurement range
config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // Bandwidth parameter

// In bmi270_toy_enable_any_motion_int()
uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_GYRO };  // Sensor configuration
```

## Usage

1. **Build and Flash**:
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **Run Test**:
   - Move or shake the sensor to trigger any motion detection
   - Observe the detection results in serial output
   - Adjust sensitivity according to actual needs

## Output Example

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