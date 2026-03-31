idf_component_register(
    SRCS "circle_gesture_main.c"
    INCLUDE_DIRS "."
)

include(package_manager)
cu_pkg_define_version(${CMAKE_CURRENT_LIST_DIR})
