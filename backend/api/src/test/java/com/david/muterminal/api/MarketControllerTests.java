package com.david.muterminal.api;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MarketControllerTests {
    private HttpServer server;
    private MarketController controller;
    private final AtomicReference<String> path = new AtomicReference<>();
    private int responseStatus = 200;
    private String responseBody = "{\"ticker\":\"AAPL\",\"price\":150,\"currency\":\"USD\"}";

    @BeforeEach
    void setUp() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            path.set(exchange.getRequestURI().toString());
            var bytes = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(responseStatus, bytes.length);
            try (var body = exchange.getResponseBody()) { body.write(bytes); }
        });
        server.start();
        controller = new MarketController("http://127.0.0.1:" + server.getAddress().getPort());
    }

    @AfterEach
    void tearDown() { if (server != null) server.stop(0); }

    @Test
    void forwardsQuoteAndHistoryQuery() {
        assertEquals(200, controller.getQuote("AAPL").getStatusCode().value());
        assertEquals("/quotes/AAPL", path.get());
        assertEquals(200, controller.getHistory("AAPL", "2024-01-06").getStatusCode().value());
        assertEquals("/quotes/AAPL/history?purchase_date=2024-01-06", path.get());
    }

    @Test
    void forwardsSearchAndFxWithoutQueryInjection() {
        assertEquals(200, controller.search("Apple & funds").getStatusCode().value());
        assertEquals("/search?q=Apple%20%26%20funds", path.get());
        assertEquals(200, controller.getExchangeRate("USD", "NOK").getStatusCode().value());
        assertEquals("/fx/USD/NOK", path.get());
        assertEquals(200, controller.getHistoricalExchangeRate("USD", "NOK", "2024-01-06").getStatusCode().value());
        assertEquals("/fx/USD/NOK/history?purchase_date=2024-01-06", path.get());
        controller.getHistoricalExchangeRate("USD", "NOK", "2024-01-06&injected=1");
        assertEquals("/fx/USD/NOK/history?purchase_date=2024-01-06%26injected%3D1", path.get());
    }

    @Test
    void preservesProviderErrorStatusAndMessage() {
        responseStatus = 404;
        responseBody = "{\"detail\":\"No market prices found\"}";
        var response = controller.getQuote("INVALID");
        assertEquals(404, response.getStatusCode().value());
        assertEquals(responseBody, response.getBody());
    }

    @Test
    void unavailableServiceReturnsRecoverableError() {
        server.stop(0);
        assertEquals(503, controller.getQuote("AAPL").getStatusCode().value());
    }
}
