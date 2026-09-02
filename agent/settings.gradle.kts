// Downloads the JDK named by the toolchain block on first build, so nothing needs to be installed by hand.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "warden-agent"
