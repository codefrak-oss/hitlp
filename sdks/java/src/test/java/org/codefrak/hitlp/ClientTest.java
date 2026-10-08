package org.codefrak.hitlp;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.TimeUnit;
import org.codefrak.hitlp.testing.FakeTransport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

class ClientTest {
    final List<Long> slept = new ArrayList<>();
    final Sleeper fakeSleep = (ms, signal) -> slept.add(ms);

    static AskRequest ask() {
        return Ask.buildAsk(Ask.input()
                .deadline("2026-10-09T09:00:00Z").defaultOnTimeout("reject")
                .question("Which currency?").responseSchema(Map.of("type", "string")));
    }

    static ApproveRequest approve() {
        return Approve.buildApprove(Approve.input()
                .deadline("2026-10-15T12:00:00Z").action("deploy").payload(Map.of("v", 1)).payloadDigest("sha256:aa"));
    }

    static Map<String, Object> record(String key, String primitive, String outcome, Map<String, ?> extra) {
        Map<String, Object> r = new HashMap<>(Map.of(
                "idempotencyKey", key, "primitive", primitive, "outcome", outcome,
                "decidedBy", Map.of("type", "human", "id", "h1"), "decidedAt", "2026-10-08T15:20:00Z"));
        r.putAll(extra);
        return r;
    }

    @Test
    void askReturnsTheTaskHandleAtOnceWithoutWaiting() {
        FakeTransport t = new FakeTransport();
        Task task = new HitlpClient(t).ask(ask());
        assertEquals(TaskStatus.WORKING, task.status());
        assertEquals("human.ask", t.calls.get(0).name());
        assertEquals(0, t.gets.size());
    }

    @Test
    void waitForTerminalNeverPollsFasterThanPollInterval() throws Exception {
        AskRequest req = ask();
        int[] polls = {0};
        FakeTransport t = new FakeTransport(750L) {
            @Override
            public synchronized Task getTask(String id) {
                if (++polls[0] == 3) complete(id, record(req.idempotencyKey(), "ask", "answered", Map.of("answer", "EUR")));
                return super.getTask(id);
            }
        };
        HitlpClient client = new HitlpClient(t, new HitlpClient.Options().sleeper(fakeSleep));
        Task done = client.waitForTerminal(client.ask(req));
        assertEquals(TaskStatus.COMPLETED, done.status());
        assertEquals("EUR", Decisions.answerOf(done.result(), String.class));
        assertEquals(List.of(750L, 750L, 750L), slept);
    }

    @Test
    void waitForTerminalUsesTheDefaultIntervalWhenTheServerGivesNone() throws Exception {
        AskRequest req = ask();
        FakeTransport t = new FakeTransport(null) {
            @Override
            public synchronized Task getTask(String id) {
                complete(id, record(req.idempotencyKey(), "ask", "answered", Map.of("answer", "EUR")));
                return super.getTask(id);
            }
        };
        HitlpClient client = new HitlpClient(t, new HitlpClient.Options().defaultPollInterval(2000).sleeper(fakeSleep));
        client.waitForTerminal(client.ask(req));
        assertEquals(List.of(2000L), slept);
    }

    @Test
    void waitForTerminalHonoursAnAlreadyCancelledSignal() {
        FakeTransport t = new FakeTransport();
        HitlpClient client = new HitlpClient(t, new HitlpClient.Options().sleeper(fakeSleep));
        Task task = client.ask(ask());
        CancelSignal signal = new CancelSignal();
        signal.cancel("stop");
        CancellationException e = assertThrows(CancellationException.class,
                () -> client.waitForTerminal(task.withPollInterval(null), new HitlpClient.WaitOptions().signal(signal)));
        assertEquals("stop", e.getMessage());
    }

    @Test
    @Timeout(value = 5, unit = TimeUnit.SECONDS)
    void cancellingTheSignalWakesARealSleep() throws Exception {
        FakeTransport t = new FakeTransport(60_000L);
        HitlpClient client = new HitlpClient(t);
        Task task = client.ask(ask());
        CancelSignal signal = new CancelSignal();
        new Thread(() -> {
            try {
                Thread.sleep(50);
            } catch (InterruptedException ignored) {
                // cancel anyway
            }
            signal.cancel("stop");
        }).start();
        assertThrows(CancellationException.class, () -> client.waitForTerminal(task, new HitlpClient.WaitOptions().signal(signal)));
    }

    @Test
    void inputRequiredIsReportedAndPollingGoesOn() throws Exception {
        AskRequest req = ask();
        FakeTransport t = new FakeTransport();
        HitlpClient client = new HitlpClient(t, new HitlpClient.Options().sleeper((ms, s) -> {
            t.complete("task-1", record(req.idempotencyKey(), "ask", "answered", Map.of("answer", "EUR")));
        }));
        Task task = client.ask(req);
        t.setStatus(task.taskId(), TaskStatus.INPUT_REQUIRED, "needs a human");
        List<Task> seen = new ArrayList<>();
        Task done = client.waitForTerminal(task.taskId(), new HitlpClient.WaitOptions().onInputRequired(seen::add));
        assertEquals(1, seen.size());
        assertEquals(TaskStatus.COMPLETED, done.status());
    }

    @Test
    void cancelGoesThroughTasksCancel() {
        FakeTransport t = new FakeTransport();
        HitlpClient client = new HitlpClient(t);
        Task task = client.approve(approve());
        Task after = client.cancel(task.taskId());
        assertEquals(List.of(task.taskId()), t.cancels);
        assertEquals(TaskStatus.CANCELLED, after.status());
        assertEquals(Resolution.Kind.CANCELLED, Decisions.resolve(after).kind());
    }

    @Test
    void aRetriedCallSendsTheSameIdempotencyKeyAndGetsTheSameHandle() {
        FakeTransport t = new FakeTransport();
        t.failNextCalls = 1;
        HitlpClient client = new HitlpClient(t);
        ApproveRequest req = approve();
        Task task = client.approve(req);
        assertEquals(2, t.calls.size());
        assertEquals(req.idempotencyKey(), t.calls.get(0).args().get("idempotencyKey"));
        assertEquals(req.idempotencyKey(), t.calls.get(1).args().get("idempotencyKey"));
        assertEquals("task-1", task.taskId());
        Task other = client.approve(approve());
        assertNotEquals(req.idempotencyKey(), t.calls.get(2).args().get("idempotencyKey"));
        assertNotEquals(task.taskId(), other.taskId());
    }

    @Test
    void retriesGiveUpAfterCallRetries() {
        FakeTransport t = new FakeTransport();
        t.failNextCalls = 5;
        HitlpClient client = new HitlpClient(t, new HitlpClient.Options().callRetries(1));
        assertThrows(IllegalStateException.class, () -> client.ask(ask()));
        assertEquals(2, t.calls.size());
    }

    @Test
    void checkpointRoundTripThenResumeFromTheStoredTaskId() throws Exception {
        FakeTransport t = new FakeTransport();
        ApproveRequest req = approve();
        Task task = new HitlpClient(t).approve(req);
        String stored = Checkpoint.forTask(task, req, Primitive.APPROVE).serialize();

        // A new process: only the checkpoint survives.
        Checkpoint cp = Checkpoint.parse(stored);
        assertEquals(task.taskId(), cp.taskId());
        assertEquals(req.idempotencyKey(), cp.idempotencyKey());
        t.complete(cp.taskId(), record(cp.idempotencyKey(), "approve", "approved", Map.of("payloadDigest", "sha256:aa")));
        Resolution res = new HitlpClient(t, new HitlpClient.Options().sleeper(fakeSleep)).resume(cp);
        assertEquals(Resolution.Kind.DECIDED, res.kind());
        assertTrue(Decisions.isApproved(res.record(), cp));
        assertThrows(IllegalArgumentException.class, () -> Checkpoint.parse("{}"));
        assertThrows(IllegalArgumentException.class, () -> Checkpoint.parse("not json"));
    }

    @Test
    void resumeRefusesATaskThatDoesNotMatchItsCheckpoint() {
        FakeTransport t = new FakeTransport();
        ApproveRequest req = approve();
        Task task = new HitlpClient(t).approve(req);
        Checkpoint cp = Checkpoint.forTask(task, req, Primitive.APPROVE);
        t.complete(cp.taskId(), record("other-key", "approve", "approved", Map.of("payloadDigest", "sha256:aa")));
        assertThrows(IllegalStateException.class, () -> new HitlpClient(t).resume(cp));
    }

    static final DecisionRecord BASE = DecisionRecord.of(Map.of(
            "requestId", "t", "idempotencyKey", "k", "primitive", "approve", "outcome", "approved",
            "decidedBy", Map.of("type", "human", "id", "h"), "decidedAt", "2026-10-08T18:04:11Z",
            "payloadDigest", "sha256:aa"));

    static DecisionRecord with(DecisionRecord r, String field, Object value) {
        Map<String, Object> m = r.toMap();
        if (value == null) m.remove(field);
        else m.put(field, value);
        return DecisionRecord.of(m);
    }

    @Test
    void onlyAnApprovedOutcomeIsApprovalTimeoutsNeverAre() {
        assertTrue(Decisions.isApproved(BASE));
        for (String outcome : List.of("rejected", "timed_out", "cancelled")) {
            DecisionRecord r = with(with(BASE, "outcome", outcome), "decidedBy", Map.of("type", "policy"));
            assertFalse(Decisions.isApproved(r), outcome);
        }
        assertFalse(Decisions.isApproved(null));
        assertFalse(Decisions.isApproved(with(BASE, "primitive", "ask")));
        Resolution failed = Decisions.resolve(new Task("t", TaskStatus.FAILED, null, null, "default fail", null));
        assertEquals(Resolution.Kind.FAILED, failed.kind());
        assertEquals("default fail", failed.message());
        assertThrows(NotTerminalException.class, () -> Decisions.resolve(new Task("t", TaskStatus.WORKING)));
    }

    @Test
    void aPayloadDigestMismatchIsFlagged() {
        assertTrue(Decisions.verifyPayloadDigest(BASE, "sha256:aa"));
        assertFalse(Decisions.verifyPayloadDigest(with(BASE, "payloadDigest", "sha256:bb"), "sha256:aa"));
        assertFalse(Decisions.verifyPayloadDigest(with(BASE, "payloadDigest", null), "sha256:aa"));
        assertFalse(Decisions.isApproved(with(BASE, "payloadDigest", "sha256:bb"), "sha256:aa"));
        assertFalse(Decisions.isApproved(with(BASE, "payloadDigest", "sha256:bb"), approve()));
    }

    @Test
    void answerOfIsNullForAnythingButAnAnsweredAsk() {
        assertEquals(null, Decisions.answerOf(BASE));
        assertEquals(null, Decisions.answerOf(null));
    }

    @Test
    void anInvalidDecisionRecordFromTheServerIsRefused() {
        FakeTransport t = new FakeTransport();
        HitlpClient client = new HitlpClient(t, new HitlpClient.Options().sleeper(fakeSleep));
        AskRequest req = ask();
        Task task = client.ask(req);
        Map<String, Object> r = record(req.idempotencyKey(), "ask", "timed_out", Map.of());
        r.put("decidedBy", Map.of("type", "human"));
        t.complete(task.taskId(), r);
        HitlpValidationException e = assertThrows(HitlpValidationException.class, () -> client.waitForTerminal(task.taskId()));
        assertTrue(e.getMessage().startsWith("invalid ask.response"), e.getMessage());
    }

    @Test
    void reservedToolNamesAreNotCallable() {
        for (String name : List.of("human.do", "human.inform", "human.escalate")) {
            assertThrows(ReservedToolException.class, () -> Tools.assertCallableTool(name));
        }
        assertThrows(IllegalArgumentException.class, () -> Tools.assertCallableTool("human.other"));
        assertDoesNotThrow(() -> Tools.assertCallableTool("human.ask"));
    }
}
