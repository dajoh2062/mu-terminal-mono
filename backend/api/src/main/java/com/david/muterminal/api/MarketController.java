package com.david.muterminal.api;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@RestController
public class MarketController {
    private final RestClient restClient;

    public MarketController(@Value("${market-data.base-url:http://127.0.0.1:8001}") String baseUrl) {
        var factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
        factory.setReadTimeout(Duration.ofSeconds(25));
        this.restClient = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    @GetMapping("/api/market/quotes/{ticker}")
    public ResponseEntity<?> getQuote(@PathVariable String ticker) {
        return forward(restClient.get().uri("/quotes/{ticker}", ticker));
    }

    @GetMapping("/api/market/quotes/{ticker}/history")
    public ResponseEntity<?> getHistory(@PathVariable String ticker, @RequestParam String purchaseDate) {
        return forward(restClient.get().uri(builder -> builder.path("/quotes/{ticker}/history")
                .queryParam("purchase_date", purchaseDate).build(ticker)));
    }

    private ResponseEntity<?> forward(RestClient.RequestHeadersSpec<?> request) {
        try {
            return request.retrieve().toEntity(Object.class);
        } catch (RestClientResponseException error) {
            return ResponseEntity.status(error.getStatusCode()).contentType(MediaType.APPLICATION_JSON)
                    .body(error.getResponseBodyAsString());
        } catch (ResourceAccessException error) {
            return ResponseEntity.status(503).body(Map.of("detail",
                    "The market data service is unavailable. Please try again shortly."));
        }
    }

    @GetMapping("/api/market/search")
    public ResponseEntity<?> search(@RequestParam String q) {
        return forward(restClient.get().uri(builder -> builder.path("/search").queryParam("q", "{q}").build(q)));
    }

    @GetMapping("/api/market/fx/{source}/{target}")
    public ResponseEntity<?> getExchangeRate(@PathVariable String source, @PathVariable String target) {
        return forward(restClient.get().uri("/fx/{source}/{target}", source, target));
    }

    @GetMapping("/api/market/fx/{source}/{target}/history")
    public ResponseEntity<?> getHistoricalExchangeRate(@PathVariable String source, @PathVariable String target,
            @RequestParam String purchaseDate) {
        return forward(restClient.get().uri(builder -> builder.path("/fx/{source}/{target}/history")
                .queryParam("purchase_date", "{date}").build(source, target, purchaseDate)));
    }
}
