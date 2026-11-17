import groovy.json.JsonSlurper

plugins {
    kotlin("multiplatform") version "2.3.21"
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.21"
    id("org.jetbrains.compose") version "1.12.2"
    id("com.android.kotlin.multiplatform.library") version "9.1.1"
    `maven-publish`
}

group = "pics.lab"
version = providers.gradleProperty("publicationVersion").orElse(provider {
    (JsonSlurper().parse(file("../../package.json")) as Map<*, *>)["version"] as String
}).get()

val generatedSymbols = layout.buildDirectory.dir("generated/symbols")
val generatedTests = layout.buildDirectory.dir("generated/symbolTests")
val generateSymbols by tasks.registering(Exec::class) {
    workingDir(file("../.."))
    inputs.dir(file("../../symbols"))
    inputs.dir(file("../../scripts/lib"))
    inputs.dir(file("../../src/core"))
    inputs.dir(file("../../src/render"))
    inputs.file(file("../../scripts/export-native-symbols.mjs"))
    inputs.property("preview", providers.gradleProperty("previewSymbols").orElse("false"))
    outputs.dirs(generatedSymbols, generatedTests)
    commandLine("node", "scripts/export-native-symbols.mjs", "--output", generatedSymbols.get().asFile.absolutePath,
        "--fixtures", generatedTests.get().asFile.absolutePath)
    if (providers.gradleProperty("previewSymbols").orNull == "true") args("--preview")
}

kotlin {
    jvm("desktop")
    android {
        namespace = "pics.lab.icons"
        compileSdk = 37
        minSdk = 33
        compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
    iosArm64()
    iosSimulatorArm64()
    jvmToolchain(21)
    targets.withType<org.jetbrains.kotlin.gradle.targets.jvm.KotlinJvmTarget>().configureEach {
        compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
    sourceSets {
        commonMain {
            kotlin.srcDir(files(generatedSymbols).builtBy(generateSymbols))
            dependencies {
                api("org.jetbrains.compose.foundation:foundation:1.12.2")
                api("org.jetbrains.compose.ui:ui:1.12.2")
                api("org.jetbrains.compose.runtime:runtime:1.12.2")
                api("pics.lab:motion-compose:0.1.0")
            }
        }
        commonTest {
            kotlin.srcDir(files(generatedTests).builtBy(generateSymbols))
            dependencies {
                implementation(kotlin("test"))
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
            }
        }
        named("desktopTest") {
            dependencies { implementation(compose.desktop.currentOs) }
        }
    }
}

publishing {
    repositories {
        maven {
            name = "distribution"
            url = uri(providers.gradleProperty("publicationRepository").orElse(layout.buildDirectory.dir("repository").map { it.asFile.path }))
        }
    }
    publications.withType<MavenPublication>().configureEach {
        pom {
            name = "Lab Icons for Compose"
            description = "Source-backed optical symbols with shared web and native geometry"
            url = "https://github.com/Labpics-Team/lab-icons"
            licenses { license { name = "MIT"; url = "https://opensource.org/license/mit" } }
            scm { url = "https://github.com/Labpics-Team/lab-icons" }
        }
    }
}
