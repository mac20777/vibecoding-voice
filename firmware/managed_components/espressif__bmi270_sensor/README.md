# BMI270 Sensor Component for ESP-IDF

High-performance BMI270 6-axis IMU sensor driver with advanced gesture recognition support for ESP32 series chips.

## Features

### Core Capabilities
- **Full 6-axis IMU**: 3-axis accelerometer + 3-axis gyroscope
- **Multiple Firmware Variants**: Base, Circle, Toy
- **I2C Interface**: Flexible communication protocols
- **Interrupt Support**: Hardware interrupt-driven event detection
- **Low Power**: Advanced power management modes

### Advanced Gesture Detection

#### Circle Gesture (BMI270 Circle)
- Clockwise/counter-clockwise motion detection
- Multi-axis support (X/Y/Z rotation)
- Configurable sensitivity thresholds

#### Toy Motion (BMI270 Toy)
- Pick-up/put-down detection
- Throw gestures (up/down/catch)
- Push and shake detection
- Rolling orientation tracking
- Rotation angle measurement

#### Standard Features (BMI270 Base/Legacy)
- Any/no motion detection
- Tap detection (single/double/triple)
- Step counter & activity recognition
- Wrist gestures & orientation

## Examples

Complete examples available in `components/bmi270_sensor/examples/`:

- `any_motion` - Motion detection with interrupts
- `circle_gesture` - Circular motion recognition
- `multi_tap` - Tap gesture detection (single/double/triple)
- `push_in_air` - Push gesture in air detection
- `push_on_table` - Push gesture on table detection
- `rolling` - Device orientation tracking
- `rotation` - Rotation angle measurement
- `shake` - Shake gesture detection
- `toy_motion` - Comprehensive toy motion gestures

## Sensor Documentation

Full sensor reference: [Bosch BMI270 Product Page](https://www.bosch-sensortec.com/products/motion-sensors/imus/bmi270.html)
