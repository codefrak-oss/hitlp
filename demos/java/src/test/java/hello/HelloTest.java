package hello;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Smoke tests: run the demo with scripted answers, as HITLP_DEMO_ANSWERS does. */
class HelloTest {
    @TempDir
    Path tmp;

    final List<String> lines = new ArrayList<>();

    Hello.Result run(String... answers) throws Exception {
        return Hello.hello(TerminalHuman.scriptedPrompt(List.of(answers), lines::add), lines::add, tmp.resolve("cp.json"));
    }

    @Test
    void greetsAndDeploysOnceApproved() throws Exception {
        assertEquals(new Hello.Result("Ada", true), run("Ada", "y"));
        assertTrue(lines.contains("[agent] Hello, Ada!"), lines.toString());
        assertTrue(lines.contains("[agent] Approved by terminal-human. Deploying \"Hello, Ada!\" ... done."), lines.toString());
        assertFalse(Files.exists(tmp.resolve("cp.json")));
    }

    @Test
    void doesNotDeployWhenRejected() throws Exception {
        assertEquals(new Hello.Result("Ada", false), run("Ada", "n"));
        assertTrue(lines.contains("[agent] Not approved (rejected); nothing deployed."), lines.toString());
    }
}
