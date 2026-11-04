import { House } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AiAssistantCard } from '../pages/Settings';
import { MagicInputButton } from '../components/app/MagicInput';
import { FamilyHubNav } from './FamilyHubNav';
import { useAiStatus } from '../lib/aiStatus';
import './familyhub.css';
export default function AiHub() {
    const { user, isModuleEnabled } = useAuth();
    const status = useAiStatus();
    const parent = Boolean(user?.is_owner || user?.role === 'parent');
    return <div className="fh-scope fh-app"><header className="fh-header"><a href="/" className="fh-brand"><span className="fh-brand-icon"><House size={23} /></span><span>family<span className="fh-brand-hub">hub</span><small>A LITTLE MORE TOGETHER</small></span></a></header><FamilyHubNav /><main className="fh-main">
        <div className="fh-greeting"><div><p className="fh-eyebrow">Powered by OpenFamily</p><h1>A little <em>help.</em></h1><p className="fh-greeting-copy">Choose your provider and model, then turn a request into reviewed tasks and calendar events.</p></div></div>
        <section className="fh-card fh-ai-launch"><h2>AI assistant</h2><p>{status?.configured && status.enabled ? `Configured: ${status.model} via ${status.provider}. Test the connection below before use.` : 'Set up and enable a model below to start using the assistant.'}</p>{!isModuleEnabled('ai') && <p>The AI module is hidden. Enable it in OpenFamily settings to use the assistant.</p>}<MagicInputButton label="Ask the assistant" /></section>
        <div className="fh-ai-settings"><AiAssistantCard isParent={parent} /></div>
        <p className="fh-fine-print">Ollama can use a model you have installed, including Llama. Other providers use their configured model name and credentials. This reuses OpenFamily’s review-before-saving assistant; daycare emails are not sent to it.</p>
        <a className="fh-text-button" href="/settings">All OpenFamily settings</a>
    </main></div>;
}
