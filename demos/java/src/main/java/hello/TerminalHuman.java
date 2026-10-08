package hello;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.UnaryOperator;
import org.codefrak.hitlp.DecisionRecord;
import org.codefrak.hitlp.Task;
import org.codefrak.hitlp.TaskStatus;
import org.codefrak.hitlp.TaskTransport;
import org.codefrak.hitlp.Tools;

/**
 * The human's side of a HITLP server, shrunk to a terminal for the demo.
 *
 * <p>It only stores the task and turns what the person types into a decision
 * record; envelopes, validation, polling and deciding what a record means are the
 * SDK's. It is NOT a conforming HITLP server: its task store lives in memory (rule
 * R1), and its human is whoever sits at this terminal.
 */
public final class TerminalHuman implements TaskTransport {
    /** Shows a question and returns the human's reply. */
    public interface Prompt extends UnaryOperator<String> {}

    private static final ObjectMapper JSON = new ObjectMapper();

    private record Entry(Task task, String name, Map<String, Object> args) {}

    private final Prompt prompt;
    private final String humanId;
    private final Map<String, Entry> tasks = new LinkedHashMap<>();
    private final Map<String, String> byKey = new HashMap<>();

    public TerminalHuman(Prompt prompt) {
        this(prompt, "terminal-human");
    }

    public TerminalHuman(Prompt prompt, String humanId) {
        this.prompt = prompt;
        this.humanId = humanId;
    }

    /** Reads a reply from stdin, typed or piped. */
    public static Prompt terminalPrompt() {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        return question -> {
            System.out.print(question);
            System.out.flush();
            try {
                String line = in.readLine();
                if (line == null) throw new IllegalStateException("stdin closed before the human replied");
                return line.strip();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        };
    }

    /** Replays scripted replies (HITLP_DEMO_ANSWERS), echoing them as if typed. */
    public static Prompt scriptedPrompt(List<String> answers, Consumer<String> write) {
        Deque<String> queue = new ArrayDeque<>(answers);
        return question -> {
            if (queue.isEmpty()) throw new IllegalStateException("ran out of scripted answers");
            String reply = queue.removeFirst();
            write.accept(question + reply);
            return reply;
        };
    }

    @Override
    public Task callTool(String name, Map<String, Object> args) {
        String key = (String) args.get("idempotencyKey");
        String id = byKey.get(key);
        if (id == null) {
            id = "task-" + (tasks.size() + 1);
            byKey.put(key, id);
            tasks.put(id, new Entry(new Task(id, TaskStatus.WORKING, null, 10L, null, null), name, args));
        }
        return tasks.get(id).task();
    }

    @Override
    public Task getTask(String taskId) {
        Entry e = tasks.get(taskId);
        if (e.task().status() == TaskStatus.WORKING) {
            Task done = e.task().withResult(decide(taskId, e.name(), e.args())).withStatus(TaskStatus.COMPLETED, null);
            e = new Entry(done, e.name(), e.args());
            tasks.put(taskId, e);
        }
        return e.task();
    }

    @Override
    public Task cancelTask(String taskId) {
        Entry e = tasks.get(taskId);
        if (e.task().status() == TaskStatus.WORKING) {
            e = new Entry(e.task().withStatus(TaskStatus.CANCELLED, null), e.name(), e.args());
            tasks.put(taskId, e);
        }
        return e.task();
    }

    private DecisionRecord decide(String taskId, String name, Map<String, Object> args) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("requestId", taskId);
        record.put("idempotencyKey", args.get("idempotencyKey"));
        record.put("decidedBy", Map.of("type", "human", "id", humanId));
        record.put("channel", "terminal");
        if (Tools.ASK_TOOL.equals(name)) {
            String answer = prompt.apply("[human] " + args.get("question") + " ");
            record.put("primitive", "ask");
            record.put("outcome", "answered");
            record.put("answer", answer);
            record.put("decidedAt", Instant.now().toString());
            return DecisionRecord.of(record);
        }
        String reply = prompt.apply("[human] Approve \"" + args.get("action") + "\" " + json(args.get("payload")) + "? [y/N] ");
        boolean approved = reply.matches("(?i)y(es)?");
        record.put("primitive", "approve");
        record.put("outcome", approved ? "approved" : "rejected");
        record.put("decidedAt", Instant.now().toString());
        if (!approved) record.put("reason", "declined at the terminal");
        if (args.containsKey("payloadDigest")) record.put("payloadDigest", args.get("payloadDigest"));
        return DecisionRecord.of(record);
    }

    private static String json(Object value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException(e);
        }
    }
}
