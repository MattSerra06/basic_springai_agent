package com.example.agent.chat;

import jakarta.validation.constraints.NotBlank;

public record ChatRequest(@NotBlank String message) {
}
