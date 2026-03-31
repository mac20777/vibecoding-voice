idf_component_register(
    SRCS "multi_tap_main.c"
    INCLUDE_DIRS "."
)

include(package_manager)
cu_pkg_define_version(${CMAKE_CURRENT_LIST_DIR})
