# Cypress Tests for Obsidian Chat Stream Plugin

This directory contains end-to-end and component tests for the Obsidian Chat Stream plugin using Cypress.

## Test Structure

```
cypress/
├── e2e/                          # End-to-end tests
│   ├── plugin-loading.cy.js      # Plugin initialization and loading tests
│   ├── settings.cy.js            # Settings configuration tests
│   ├── canvas-interaction.cy.js  # Canvas and note generation tests
│   ├── streaming.cy.js           # Streaming functionality tests
│   ├── provider-switching.cy.js  # OpenAI/Gemini provider switching tests
│   └── integration-workflows.cy.js # Complex workflow and integration tests
├── fixtures/                     # Test data and mock responses
│   ├── api-responses.json        # Mock API responses for testing
│   └── test-settings.json        # Test configuration presets
├── support/                      # Cypress support files
│   ├── e2e.js                   # E2E test configuration and custom commands
│   ├── commands.js              # Custom Cypress commands
│   └── component.js             # Component test configuration
├── screenshots/                  # Test failure screenshots (auto-generated)
└── videos/                      # Test run videos (auto-generated)
```

## Running Tests

### Prerequisites

1. Install dependencies:

```bash
npm install
```

2. Ensure the plugin is built:

```bash
npm run build
```

### Test Commands

Run all Cypress tests (headless):

```bash
npm run test:cypress
```

Open Cypress Test Runner (interactive):

```bash
npm run test:cypress:open
```

Run only E2E tests:

```bash
npm run test:e2e
```

Run only component tests:

```bash
npm run test:component
```

Run all tests (Jest + Cypress):

```bash
npm run test:all
```

## Test Categories

### 1. Plugin Loading Tests (`plugin-loading.cy.js`)

- Verifies plugin loads successfully
- Checks command registration
- Validates default settings
- Tests hotkey registration
- Ensures no console errors

### 2. Settings Tests (`settings.cy.js`)

- API key configuration
- Provider switching (OpenAI ↔ Gemini)
- Temperature and token limit validation
- Settings persistence
- Streaming and mindmap settings

### 3. Canvas Interaction Tests (`canvas-interaction.cy.js`)

- Canvas creation and note addition
- AI note generation
- Mindmap creation with auto-split
- Error handling
- Token limit enforcement
- Custom system prompts

### 4. Streaming Tests (`streaming.cy.js`)

- Progressive content streaming
- Streaming progress indicators
- Auto-split during streaming
- Pause/resume controls
- Error retry mechanisms
- Timeout handling
- Performance metrics

### 5. Provider Switching Tests (`provider-switching.cy.js`)

- OpenAI to Gemini switching
- API endpoint validation
- Response format handling
- Provider-specific error handling
- API key validation

### 6. Integration Workflow Tests (`integration-workflows.cy.js`)

- Complete conversation workflows
- Complex mindmap creation
- Mid-conversation provider switching
- Conversation depth limits
- Concurrent request handling
- State persistence
- Streaming interruption recovery

## Custom Cypress Commands

### Setup Commands

- `cy.waitForObsidianLoad()` - Wait for Obsidian to fully load
- `cy.checkPluginLoaded(pluginId)` - Verify plugin is loaded and enabled
- `cy.setPluginSettings(settings)` - Configure plugin settings

### Canvas Commands

- `cy.openCanvas()` - Create a new canvas
- `cy.addNoteToCanvas(content)` - Add a note to the canvas
- `cy.verifyCanvasNode(text)` - Verify a canvas node exists with specific text

### UI Commands

- `cy.triggerCommand(commandId)` - Execute plugin commands via command palette
- `cy.openSettingsTab()` - Open plugin settings tab

### API Mocking Commands

- `cy.mockOpenAIResponse(response)` - Mock OpenAI API responses
- `cy.shouldNotHaveConsoleErrors()` - Assert no console errors occurred

## Test Data and Fixtures

### API Responses (`fixtures/api-responses.json`)

Contains mock responses for:

- OpenAI chat completions
- Gemini generate content
- Streaming responses
- Error responses

### Test Settings (`fixtures/test-settings.json`)

Predefined setting configurations for:

- Default settings
- Streaming enabled
- Mindmap configuration
- Gemini provider
- Debug mode
- High token limits
- Minimal settings

## Mocking Strategy

Tests use Cypress's `cy.intercept()` to mock API calls:

```javascript
// Mock OpenAI response
cy.intercept('POST', '**/chat/completions', {
	statusCode: 200,
	body: mockResponse
}).as('openaiRequest')

// Mock Gemini response
cy.intercept('POST', '**/generateContent*', {
	statusCode: 200,
	body: mockResponse
}).as('geminiRequest')
```

## Test Environment

Tests assume:

- Obsidian is running and accessible
- Plugin is installed and available
- Canvas functionality is available
- Network requests can be intercepted

## Debugging Tests

1. Use `cy.debug()` to pause test execution
2. Add `{ timeout: 10000 }` to commands that need more time
3. Check `cypress/screenshots/` for failure screenshots
4. Check `cypress/videos/` for test run recordings
5. Use Cypress Test Runner for interactive debugging

## Best Practices

1. **Test Isolation**: Each test should be independent
2. **Setup/Teardown**: Use `beforeEach()` for test setup
3. **Assertions**: Use specific assertions over generic ones
4. **Waits**: Use `cy.wait()` for API calls, avoid arbitrary waits
5. **Selectors**: Use data attributes when possible
6. **Mocking**: Mock external APIs consistently

## Continuous Integration

For CI environments, use:

```bash
npx cypress run --headless --browser chrome
```

Add to your CI pipeline after building the plugin and before deployment.

## Troubleshooting

### Common Issues

1. **Plugin not loading**: Ensure plugin is built and enabled
2. **Obsidian not available**: Check baseUrl in cypress.config.js
3. **API mocking not working**: Verify intercept patterns match actual requests
4. **Timeouts**: Increase timeout values for slower operations
5. **Canvas issues**: Ensure canvas is properly loaded before interactions

### Debug Commands

```bash
# Run specific test file
npx cypress run --spec "cypress/e2e/plugin-loading.cy.js"

# Run with debug output
DEBUG=cypress:* npx cypress run

# Run in headed mode for debugging
npx cypress run --headed --no-exit
```
