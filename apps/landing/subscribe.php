<?php
/**
 * Bookalyze waitlist endpoint for Hostinger.
 *
 * Adds a sign-up to Resend Contacts (and the waitlist segment). The API key lives in
 * bookalyze-config.php OUTSIDE public_html (see README.md), never in this folder.
 *
 * POST JSON { "email": "...", "website": "" (honeypot), "source": "hero" }
 * Responds JSON { "ok": true } or { "ok": false, "error": "..." }.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Method not allowed']);
}

// Only accept requests from our own site.
$allowedHosts = ['bookalyze.com', 'www.bookalyze.com', 'localhost', '127.0.0.1'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && !in_array(parse_url($origin, PHP_URL_HOST), $allowedHosts, true)) {
    respond(403, ['ok' => false, 'error' => 'Forbidden']);
}

// Configuration: file one level above the web root, or environment variables.
$config = [];
$configFile = dirname($_SERVER['DOCUMENT_ROOT'] ?? __DIR__) . '/bookalyze-config.php';
if (is_file($configFile)) {
    $config = require $configFile;
}
$apiKey = $config['RESEND_API_KEY'] ?? getenv('RESEND_API_KEY') ?: '';
$segmentId = $config['RESEND_SEGMENT_ID'] ?? getenv('RESEND_SEGMENT_ID') ?: '';
if ($apiKey === '') {
    error_log('Bookalyze waitlist: RESEND_API_KEY is not configured');
    respond(500, ['ok' => false, 'error' => 'Sign-ups are not available right now.']);
}

$input = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($input)) {
    $input = $_POST;
}

// Honeypot: real visitors never fill the hidden "website" field. Pretend success for bots.
if (!empty($input['website'])) {
    respond(200, ['ok' => true]);
}

$email = strtolower(trim((string) ($input['email'] ?? '')));
if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    respond(422, ['ok' => false, 'error' => 'Please enter a valid email address.']);
}

// Basic rate limit: 5 attempts per IP per 10 minutes.
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$bucket = sys_get_temp_dir() . '/bookalyze-waitlist-' . hash('sha256', $ip);
$now = time();
$hits = array_filter(
    array_map('intval', is_file($bucket) ? explode(',', (string) file_get_contents($bucket)) : []),
    fn (int $t) => $t > $now - 600,
);
if (count($hits) >= 5) {
    respond(429, ['ok' => false, 'error' => 'Too many attempts. Please try again in a few minutes.']);
}
$hits[] = $now;
@file_put_contents($bucket, implode(',', $hits), LOCK_EX);

function resend(string $method, string $path, string $apiKey, ?array $body = null): array
{
    $ch = curl_init('https://api.resend.com' . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
            'User-Agent: bookalyze-waitlist/1.0',
        ],
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$status, is_string($raw) ? (json_decode($raw, true) ?? []) : []];
}

$contact = ['email' => $email, 'unsubscribed' => false];
if ($segmentId !== '') {
    $contact['segments'] = [['id' => $segmentId]];
}

[$status, $data] = resend('POST', '/contacts', $apiKey, $contact);

if ($status >= 200 && $status < 300) {
    respond(200, ['ok' => true]);
}

// Already a contact: make sure they're in the waitlist segment and treat it as success.
$message = strtolower((string) ($data['message'] ?? ''));
if ($status === 409 || str_contains($message, 'already exists')) {
    if ($segmentId !== '') {
        resend('POST', '/contacts/' . rawurlencode($email) . '/segments/' . rawurlencode($segmentId), $apiKey);
    }
    respond(200, ['ok' => true, 'existing' => true]);
}

error_log('Bookalyze waitlist: Resend returned ' . $status . ' ' . json_encode($data));
respond(502, ['ok' => false, 'error' => 'Something went wrong. Please try again in a moment.']);
