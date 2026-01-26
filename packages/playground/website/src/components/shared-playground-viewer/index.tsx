import { useEffect, useState, useCallback, useRef } from 'react';
import css from './style.module.css';

interface SharedPlaygroundViewerProps {
	sessionId: string;
}

type ConnectionStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

export function SharedPlaygroundViewer({
	sessionId,
}: SharedPlaygroundViewerProps) {
	const [status, setStatus] = useState<ConnectionStatus>('connecting');
	const [error, setError] = useState<string | null>(null);
	const [scope, setScope] = useState<string>('');
	const iframeRef = useRef<HTMLIFrameElement>(null);

	// Check if the session is valid and register the scope with the service worker
	useEffect(() => {
		let mounted = true;
		let registeredScope: string | null = null;

		const checkSession = async () => {
			try {
				// Fetch session info to check host connection and get scope
				const infoResponse = await fetch(
					`${window.location.origin}/relay/${sessionId}/info`
				);

				if (!infoResponse.ok) {
					if (infoResponse.status === 404) {
						setError(
							'This sharing session has expired or does not exist.'
						);
					} else {
						setError(
							`Connection failed: ${infoResponse.statusText}`
						);
					}
					setStatus('error');
					return;
				}

				const sessionInfo = await infoResponse.json();

				if (!sessionInfo.hostConnected) {
					setError(
						'The host is not connected. Please try again later.'
					);
					setStatus('error');
					return;
				}

				// Register this scope with the service worker as relay-backed
				if (navigator.serviceWorker?.controller) {
					// Use MessageChannel for request-response pattern
					const messageChannel = new MessageChannel();
					const registrationPromise = new Promise<void>((resolve) => {
						messageChannel.port1.onmessage = (event) => {
							if (event.data?.success) {
								resolve();
							}
						};
					});

					navigator.serviceWorker.controller.postMessage(
						{
							type: 'register-relay-scope',
							scope: sessionInfo.scope,
							sessionId: sessionId,
						},
						[messageChannel.port2]
					);

					registeredScope = sessionInfo.scope;

					// Wait for service worker to confirm registration
					await registrationPromise;
				}

				if (!mounted) return;

				// Store the scope and mark as connected
				setScope(sessionInfo.scope);
				setStatus('connected');
			} catch (err) {
				if (!mounted) return;
				setError(
					'Unable to connect to the shared Playground. Please check your connection.'
				);
				setStatus('error');
			}
		};

		checkSession();

		// Cleanup: unregister the scope when component unmounts
		return () => {
			mounted = false;
			if (registeredScope && navigator.serviceWorker?.controller) {
				navigator.serviceWorker.controller.postMessage({
					type: 'unregister-relay-scope',
					scope: registeredScope,
				});
			}
		};
	}, [sessionId]);

	const handleIframeLoad = useCallback(() => {
		setStatus('connected');
	}, []);

	const handleRetry = () => {
		setStatus('connecting');
		setError(null);
		// Force iframe reload
		if (iframeRef.current && scope) {
			iframeRef.current.src = `/scope:${scope}/`;
		}
	};

	return (
		<div className={css.sharedPlaygroundViewer}>
			<div className={css.banner}>
				<div className={css.bannerContent}>
					<span className={css.bannerIcon}>👁️</span>
					<span className={css.bannerText}>
						Viewing a shared Playground
					</span>
					{status === 'connected' && (
						<span className={css.statusConnected}>● Connected</span>
					)}
					{status === 'connecting' && (
						<span className={css.statusConnecting}>
							● Connecting...
						</span>
					)}
				</div>
				<a href="/" className={css.createOwnButton}>
					Create your own Playground
				</a>
			</div>

			{status === 'error' && error && (
				<div className={css.errorContainer}>
					<div className={css.errorContent}>
						<h2>Unable to Connect</h2>
						<p>{error}</p>
						<div className={css.errorActions}>
							<button
								onClick={handleRetry}
								className={css.retryButton}
							>
								Try Again
							</button>
							<a href="/" className={css.homeLink}>
								Go to Playground
							</a>
						</div>
					</div>
				</div>
			)}

			{status === 'connecting' && (
				<div className={css.loadingContainer}>
					<div className={css.loadingContent}>
						<div className={css.spinner}></div>
						<p>Connecting to shared Playground...</p>
					</div>
				</div>
			)}

			{(status === 'connected' || status === 'connecting') && scope && (
				<iframe
					ref={iframeRef}
					src={`/scope:${scope}/`}
					className={css.iframe}
					onLoad={handleIframeLoad}
					title="Shared WordPress Playground"
					style={{
						opacity: status === 'connected' ? 1 : 0,
					}}
				/>
			)}
		</div>
	);
}

/**
 * Check if the current URL contains a share parameter.
 */
export function getShareSessionId(): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get('share');
}
