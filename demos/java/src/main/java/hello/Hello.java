package hello;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;
import org.codefrak.hitlp.Approve;
import org.codefrak.hitlp.ApproveRequest;
import org.codefrak.hitlp.Ask;
import org.codefrak.hitlp.AskRequest;
import org.codefrak.hitlp.Checkpoint;
import org.codefrak.hitlp.Decisions;
import org.codefrak.hitlp.HitlpClient;
import org.codefrak.hitlp.Primitive;
import org.codefrak.hitlp.Resolution;
import org.codefrak.hitlp.Task;

/**
 * A hello world HITLP (human-in-the-loop-protocol) agent on the Java SDK.
 *
 * <p>It asks the human their name (Ask), greets them, then asks approval to deploy
 * a greeting (Approve) and goes on only if approved.
 */
public final class Hello {
    public record Result(String name, boolean deployed) {}

    private Hello() {}

    public static Result hello(TerminalHuman.Prompt prompt, Consumer<String> log, Path checkpointFile)
            throws IOException, InterruptedException {
        HitlpClient client = new HitlpClient(new TerminalHuman(prompt));
        Map<String, Object> requester = Map.of("agent", "hitlp-hello-java");

        // Ask: the call returns a task handle at once; the human answers later.
        log.accept("[agent] Asking the human for their name (human.ask) ...");
        AskRequest ask = Ask.buildAsk(Ask.input()
                .question("What is your name?")
                .responseSchema(Map.of("type", "string", "minLength", 1))
                .deadline(inAnHour())
                .defaultOnTimeout("cancel")
                .requester(requester));
        Task asked = client.waitForTerminal(client.ask(ask));
        String name = Decisions.answerOf(asked.result(), String.class);
        if (name == null || name.isEmpty()) {
            log.accept("[agent] No answer (" + asked.status().wire() + "); stopping.");
            return new Result(null, false);
        }
        log.accept("[agent] Hello, " + name + "!");

        // Approve: checkpoint the handle before yielding (rule R3), then resume from it.
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("greeting", "Hello, " + name + "!");
        payload.put("target", "hello-world");
        ApproveRequest approve = Approve.buildApprove(Approve.input()
                .action("deploy.greeting")
                .payload(payload)
                .deadline(inAnHour())
                .requester(requester));
        log.accept("[agent] Requesting approval for " + approve.action() + " (human.approve) ...");
        Task task = client.approve(approve);
        Files.writeString(checkpointFile, Checkpoint.forTask(task, approve, Primitive.APPROVE).serialize());
        log.accept("[agent] Checkpointed task " + task.taskId() + "; resuming from the checkpoint.");

        Resolution resolution = client.resume(Checkpoint.parse(Files.readString(checkpointFile)));
        Files.deleteIfExists(checkpointFile);
        if (resolution.kind() == Resolution.Kind.DECIDED && Decisions.isApproved(resolution.record(), approve)) {
            log.accept("[agent] Approved by " + resolution.record().decidedBy().get("id")
                    + ". Deploying \"Hello, " + name + "!\" ... done.");
            return new Result(name, true);
        }
        String outcome = resolution.record() != null ? resolution.record().outcome() : resolution.kind().name().toLowerCase();
        log.accept("[agent] Not approved (" + outcome + "); nothing deployed.");
        return new Result(name, false);
    }

    private static Instant inAnHour() {
        return Instant.now().plus(Duration.ofHours(1));
    }

    public static void main(String[] args) throws Exception {
        String scripted = System.getenv("HITLP_DEMO_ANSWERS");
        TerminalHuman.Prompt prompt = scripted != null
                ? TerminalHuman.scriptedPrompt(Arrays.asList(scripted.split(",")), System.out::println)
                : TerminalHuman.terminalPrompt();
        hello(prompt, System.out::println, Path.of(".hitlp-demo-checkpoint.json"));
    }
}
