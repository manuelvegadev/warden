// Warden Agent: the Paper plugin that streams player positions and simplified chunks to wardend (ADR-018).
plugins {
    java
}

group = "io.github.manuelvega.warden"
version = "0.1.0"

repositories {
    // Paper's repository first: it serves paper-api and what it depends on (Mojang's and md-5's
    // artifacts included). Asking Maven Central for those costs a request per artifact that it
    // answers with 404, or, on a busy runner, with 429 and a failed build, so it is never asked.
    maven("https://repo.papermc.io/repository/maven-public/")
    mavenCentral {
        content {
            excludeGroupAndSubgroups("io.papermc")
            excludeGroup("com.mojang")
            excludeGroup("net.md-5")
        }
    }
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
