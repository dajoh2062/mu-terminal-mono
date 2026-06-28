package com.david.muterminal.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

@RestController
public class MarketController {

    private final RestClient restClient = RestClient.create("http://127.0.0.1:8001");

    @GetMapping("/api/market/quotes/{ticker}")
    public Object getQuote(@PathVariable String ticker) {
        return restClient
                .get()
                .uri("/quotes/{ticker}", ticker)
                .retrieve()
                .body(Object.class);
    }
}
