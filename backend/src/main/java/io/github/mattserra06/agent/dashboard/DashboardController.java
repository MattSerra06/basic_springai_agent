package io.github.mattserra06.agent.dashboard;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;

/**
 * What a dashboard needs from the backend: the data tools its interface calls from the
 * browser, and the place where the user keeps the dashboards worth keeping.
 */
@RestController
@RequestMapping("/api")
public class DashboardController {

    /** Arguments of a tool call are a few names and dates, not a document. */
    private static final int MOST_ARGUMENT_CHARS = 4_000;

    private final DataTools tools;
    private final DashboardStore dashboards;

    public DashboardController(DataTools tools, DashboardStore dashboards) {
        this.tools = tools;
        this.dashboards = dashboards;
    }

    /** The tools an interface may call; none when there is no data source. */
    @GetMapping("/tools")
    public List<DataTools.Spec> tools() {
        return tools.specs();
    }

    /**
     * Runs a data tool for an interface. The body is the arguments of the call; the
     * answer is {@code {"data": ...}}, the tool's own JSON. 404 for a tool interfaces
     * may not call, 400 for arguments that are not a JSON object, 502 with
     * {@code {"error": "..."}} when the tool failed.
     */
    @PostMapping("/tools/{name}")
    public ResponseEntity<Map<String, Object>> call(@PathVariable String name,
            @RequestBody(required = false) JsonNode arguments) {
        // A tool that takes no argument may be called without a body
        JsonNode given = (arguments == null || arguments.isNull()) ? JsonNodeFactory.instance.objectNode()
                : arguments;
        if (!given.isObject() || given.toString().length() > MOST_ARGUMENT_CHARS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The arguments must be a JSON object");
        }
        try {
            return ResponseEntity.ok(Map.of("data", tools.call(name, given)));
        }
        catch (NoSuchElementException unknown) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, unknown.getMessage());
        }
        catch (DataTools.ToolFailedException failed) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", failed.getMessage()));
        }
    }

    /** A dashboard to keep. */
    public record NewDashboard(@NotBlank @Size(max = 120) String title,
                               @NotBlank @Size(max = 100_000) String program) {
    }

    @PostMapping("/dashboards")
    @ResponseStatus(HttpStatus.CREATED)
    public DashboardStore.Dashboard keep(@Valid @RequestBody NewDashboard dashboard) {
        return dashboards.keep(dashboard.title(), dashboard.program());
    }

    /** The dashboards kept, the most recent first, without their programs. */
    @GetMapping("/dashboards")
    public List<DashboardStore.Entry> list() {
        return dashboards.list();
    }

    @GetMapping("/dashboards/{id}")
    public DashboardStore.Dashboard open(@PathVariable String id) {
        return dashboards.find(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown dashboard " + id));
    }

    @DeleteMapping("/dashboards/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void forget(@PathVariable String id) {
        if (!dashboards.forget(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown dashboard " + id);
        }
    }
}
