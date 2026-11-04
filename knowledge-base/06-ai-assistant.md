# AI assistant

[Knowledge base index](README.md) · [Google Calendar and Tasks](04-google-calendar-tasks.md) · [Security and privacy](13-security-privacy.md)

Family Hub exposes OpenFamily's existing AI assistant and provider settings. Parents can choose a supported provider and model, test the connection, and use the assistant to draft requests. The existing review-before-saving flow remains important: inspect the proposal before applying any task or calendar action.

Provider choices inspected during development included Ollama, OpenAI-compatible providers, Anthropic and Gemini. Availability depends on the provider, model name, credentials, network and service configuration. A model name alone does not install a model or start a server. A hosted provider may receive the prompt and any information deliberately included in it; daycare email content is not automatically sent to the assistant.

## Ollama and Llama

Ollama can serve a model such as a supported Llama variant if it is already installed and running on an accessible host. The server URL must be reachable **from the Family Hub server container**, not merely from the browser. `localhost` inside that container refers to the container itself. Consider the Raspberry Pi 4's 4 GB RAM and the model's actual memory and performance needs; choosing a model in settings does not establish that it will run acceptably on the Pi.

## Google-connected actions

Where a reviewed AI proposal creates or changes Google tasks, Family Hub routes the accepted action through the same selected Google Tasks integration used by the dashboard. It should not create a competing local task. Google authorization and household write permissions still apply. A display-scoped session is read-only.

## Gemini status

The owner encountered rejected-key/restriction errors and a provider availability/timeout error. Gemini troubleshooting was explicitly deferred. There is **no confirmed successful Gemini inference** in the project record. A successful settings save or provider connection retry is not proof that generation works.

To investigate later, verify the key belongs to the intended project/provider, that its API restrictions permit the exact requested service and method, that the model is available to that project, and that the server can reach the provider. Use the provider's current official documentation because service names, model availability and quotas change. Do not paste keys into chat or Git. Retest a harmless prompt and preserve the sanitized error if it fails.
