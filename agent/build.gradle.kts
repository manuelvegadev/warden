// Warden Agent: the Paper plugin that streams player positions and simplified chunks to wardend (ADR-018).
plugins {
    java
}

group = "io.github.manuelvega.warden"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    // Provided by the server at runtime. Compiled against 26.2; only APIs that exist since 1.21 are used.
    compileOnly("io.papermc.paper:paper-api:26.2.build.121-stable")
    testImplementation("io.papermc.paper:paper-api:26.2.build.121-stable")
    testImplementation(platform("org.junit:junit-bom:5.12.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java {
    // Minecraft 26.1+ runs on Java 25 and the API jar is compiled for it.
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

tasks.processResources {
    val props = mapOf("version" to project.version)
    inputs.properties(props)
    filesMatching("plugin.yml") {
        expand(props)
    }
}

tasks.jar {
    // A fixed name: wardend embeds this file and installs it as plugins/WardenAgent.jar.
    archiveFileName = "WardenAgent.jar"
}

tasks.test {
    useJUnitPlatform()
}
