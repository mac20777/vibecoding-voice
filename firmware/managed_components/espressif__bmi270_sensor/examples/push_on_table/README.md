# BMI270 Push on Table Detection Example

## Overview

This example demonstrates how to use the BMI270 sensor for push gesture detection on a table surface.

## Features

- **Multi-axis Detection**: Supports X, Y, Z three push directions
- **Low Power**: BMI270 INT pin triggers GPIO interrupt for hardware-level gesture detection, connecting to RTC GPIO enables deep sleep gesture wake-up
- **Real-time Processing**: Low-latency gesture recognition response
- **Table Surface Optimized**: Specialized configuration for table-based push detection

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

The following parameters can be adjusted in `push_on_table_main.c`:

```c
// High-g threshold for push detection sensitivity (optimized for table surface)
uint16_t high_g_threshold = 0x0800;  // Default threshold

// Accelerometer configuration
config[BMI2_ACCEL].cfg.acc.odr = BMI2_ACC_ODR_200HZ;    // 200Hz sampling rate
config[BMI2_ACCEL].cfg.acc.range = BMI2_ACC_RANGE_16G;  // ±16G range
config[BMI2_ACCEL].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;  // Bandwidth parameter
config[BMI2_ACCEL].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE; // Filter performance

// Gyroscope configuration  
config[BMI2_GYRO].cfg.gyr.odr = BMI2_GYR_ODR_200HZ;     // 200Hz sampling rate
config[BMI2_GYRO].cfg.gyr.range = BMI2_GYR_RANGE_2000;   // ±2000dps range
config[BMI2_GYRO].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;   // Bandwidth parameter
config[BMI2_GYRO].cfg.gyr.noise_perf = BMI2_POWER_OPT_MODE; // Noise performance
config[BMI2_GYRO].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE; // Filter performance
```

#### Advanced Configuration Functions

The example includes two specialized functions for table surface optimization:

**1. `adjust_high_g_threshold_for_on_table()`**
- **Purpose**: Optimizes high-g threshold for table surface detection
- **Function**: Sets high-g threshold to 0x0800 for more sensitive detection
- **Usage**: Called during initialization to configure sensitivity
- **Registers**: Modifies register 0x30 with threshold value

**2. `adjust_high_g_axis_by_rolling()`**
- **Purpose**: Dynamically adjusts high-g axis selection based on rolling motion
- **Function**: Analyzes rolling data to determine optimal axis configuration
- **Usage**: Called when rolling interrupt is detected
- **Logic**: 
  - Reads rolling axis data from register 0x1e
  - Disables high-g and push features temporarily
  - Updates axis selection in register 0x32
  - Re-enables features with new axis configuration

#### Customizable Parameters

You can modify these functions for different sensitivity requirements:

```c
// In adjust_high_g_threshold_for_on_table()
uint16_t high_g_threshold = 0x0800;  // Adjust sensitivity (lower = more sensitive)

// In adjust_high_g_axis_by_rolling()
uint8_t select_x = 1;  // Enable/disable X-axis detection
uint8_t select_y = 1;  // Enable/disable Y-axis detection  
uint8_t select_z = 1;  // Enable/disable Z-axis detection
```

## Usage

1. **Build and Flash**:
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **Run Test**:
   - Place the sensor on a table surface
   - Perform push gestures on the table
   - Observe the detection results in serial output
   - Adjust sensitivity according to actual needs

## Output Example

```
I (1378) bmi270_api: BMI270 sensor created successfully
I (1388) MAIN: Push feature enabled, result: 0
I (1488) MAIN: Move the sensor to get push interrupt...
I (6198) MAIN: Push generated!
I (6198) MAIN: Push direction: +x
I (6198) MAIN: Waiting 3 seconds before next detection...
I (9198) MAIN: Ready for next push detection...
I (11008) MAIN: Push generated!
I (11008) MAIN: Push direction: -y
I (11008) MAIN: Waiting 3 seconds before next detection...
```