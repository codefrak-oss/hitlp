plugins {
    `java-library`
}

group = "org.codefrak"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.18.2")
    implementation("com.networknt:json-schema-validator:1.5.6")
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java {
    withSourcesJar()
}

tasks.withType<JavaCompile>().configureEach {
    options.release = 17
    options.encoding = "UTF-8"
    options.compilerArgs.add("-Xlint:all")
}

tasks.test {
    useJUnitPlatform()
}
