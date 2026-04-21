# BMI270 Toy Motion Detection Example

## Overview

This example demonstrates how to use the BMI270 sensor for toy motion detection and gesture recognition.

## Features

- **Multi-axis Detection**: Supports X, Y, Z three motion directions
- **Low Power**: BMI270 INT pin triggers GPIO interrupt for hardware-level gesture detection, connecting to RTC GPIO enables deep sleep gesture wake-up
- **Real-time Processing**: Low-latency gesture recognition response
- **Toy Motion Optimized**: Specialized configuration for toy motion detection

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

The following parameters can be adjusted in `toy_motion_main.c`:

```c
// Toy motion detection sensitivity threshold
uint16_t toy_motion_threshold = 0x0800;  // Default threshold

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

The example includes specialized functions for toy motion optimization:

**1. `adjust_toy_motion_config()`**
- **Purpose**: Optimizes toy motion detection configuration
- **Function**: Sets toy motion threshold for optimal sensitivity
- **Usage**: Called during initialization to configure detection parameters
- **Registers**: Modifies toy motion detection registers

**2. `bmi270_toy_enable_toy_motion_int()`**
- **Purpose**: Enables toy motion interrupt functionality
- **Function**: Configures interrupt settings for toy motion detection
- **Usage**: Called to enable toy motion interrupt detection
- **Logic**: 
  - Enables accelerometer and gyroscope sensors
  - Configures interrupt mapping
  - Sets up toy motion detection parameters

#### Customizable Parameters

You can modify these functions for different sensitivity requirements:

```c
// In adjust_toy_motion_config()
// Throw gesture detection parameters (optimized for sensitivity)
uint16_t throw_min_duration = 0x04;    // Minimum duration for more sensitive detection
uint16_t throw_up_duration = 0x02;     // Throw up duration for lighter throw detection
uint16_t low_g_exit_duration = 0x01;   // Low-g exit duration for lighter fall detection
uint16_t quiet_time_duration = 0x02;   // Quiet time duration for more sensitive catch detection

// Collision detection parameters
uint16_t slope_thres = 0x0800;  // Slope threshold for more sensitive collision detection

// In bmi270_toy_enable_toy_motion_int()
uint8_t sens_list[2] = { BMI2_ACCEL, BMI2_GYRO };  // Sensor configuration
```

#### Parameter Descriptions

| Parameter | Current Value | Purpose | Impact |
|-----------|---------------|---------|---------|
| **throw_min_duration** | 0x04 | Minimum throw duration | Lower = more sensitive detection |
| **throw_up_duration** | 0x02 | Throw up gesture duration | Lower = lighter throw detection |
| **low_g_exit_duration** | 0x01 | Low-g exit duration | Lower = lighter fall detection |
| **quiet_time_duration** | 0x02 | Quiet time duration | Lower = more sensitive catch detection |
| **slope_thres** | 0x0800 | Slope threshold for collision | Lower = more sensitive collision detection |

#### Gesture Detection Optimization

The function optimizes detection for different toy motion gestures:

- **Throw Up**: Optimized with `throw_up_duration` parameter
- **Throw Down**: Enhanced with `low_g_exit_duration` parameter  
- **Throw Catch**: Improved with `quiet_time_duration` parameter
- **Collision Detection**: Tuned with `slope_thres` parameter

## Usage

1. **Build and Flash**:
   ```bash
   idf.py build
   idf.py flash monitor
   ```

2. **Run Test**:
   - Trigger toy motion detection: pick up, put down, throw up, fall down, throw and catch
   - Observe the detection results in serial output
   - Adjust sensitivity according to actual needs

## Output Example

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