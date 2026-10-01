// Email sending via Resend.
//
// Written as a general service rather than a one-off launch blast, because
// password resets, verification and safety notices will all need it and none
// of them exist yet.

const { Resend } = require('resend');

const FROM = 'Riff <admin@riff-app.co.uk>';
const REPLY_TO = 'admin@riff-app.co.uk';

let client = null;
function resend() {
  if (client) return client;
  if (!process.env.RESEND_API_KEY) return null;
  client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

/**
 * Send one email. Never throws - callers should not fail because a send did.
 * Returns { sent, id } or { sent: false, reason }.
 */
async function sendEmail(to, subject, html, text) {
  const r = resend();
  if (!r) return { sent: false, reason: 'RESEND_API_KEY is not set' };
  try {
    const res = await r.emails.send({
      from: FROM,
      to: [to],
      replyTo: REPLY_TO,
      subject: subject,
      html: html,
      text: text || undefined,
    });
    if (res.error) return { sent: false, reason: res.error.message || 'send rejected' };
    return { sent: true, id: res.data && res.data.id };
  } catch (err) {
    return { sent: false, reason: (err && err.message) || 'send failed' };
  }
}

// Kept deliberately plain: a single-column layout with inline styles is what
// survives Outlook, Gmail's clipping and dark mode without surprises.
function launchEmail(unsubUrl) {
  const html = [
    '<div style="background:#0A0E18;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '  <div style="max-width:520px;margin:0 auto;background:#151B2B;border-radius:16px;padding:32px;">',
    '    <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#F0ECE5;">Riff is live</h1>',
    '    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#CBD5E1;">',
    '      You asked us to tell you when Riff launched. It has.',
    '    </p>',
    '    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#CBD5E1;">',
    '      Riff is for meeting people properly &mdash; a conversation first, then voice,',
    '      and only then do you see each other. One deep connection at a time, or a',
    '      circle of four who get to know each other as a group.',
    '    </p>',
    '    <div style="margin:0 0 28px;">',
    '      <a href="https://apps.apple.com/gb/app/riff/" style="display:inline-block;background:#8B5CF6;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:12px;font-size:15px;font-weight:700;margin:0 8px 8px 0;">Download for iPhone</a>',
    '      <a href="https://play.google.com/store/apps/details?id=com.riffapp.mobile" style="display:inline-block;background:#22D3EE;color:#0A0E18;text-decoration:none;padding:13px 22px;border-radius:12px;font-size:15px;font-weight:700;margin:0 8px 8px 0;">Download for Android</a>',
    '    </div>',
    '    <p style="margin:0;font-size:13px;line-height:1.7;color:#8B8B96;">',
    '      Everyone starts with a seven-day free trial. Thanks for waiting.',
    '    </p>',
    '  </div>',
    '  <p style="max-width:520px;margin:20px auto 0;font-size:12px;line-height:1.6;color:#64748B;text-align:center;">',
    '    You are receiving this because you asked to be told when Riff launched.',
    '    This is the only email we will send you.<br>',
    '    <a href="' + unsubUrl + '" style="color:#8B8B96;">Unsubscribe</a> &middot; Riff Apps Limited',
    '  </p>',
    '</div>',
  ].join('\n');

  const text = [
    'Riff is live',
    '',
    'You asked us to tell you when Riff launched. It has.',
    '',
    'Riff is for meeting people properly - a conversation first, then voice, and',
    'only then do you see each other. One deep connection at a time, or a circle',
    'of four who get to know each other as a group.',
    '',
    'iPhone:  https://apps.apple.com/gb/app/riff/',
    'Android: https://play.google.com/store/apps/details?id=com.riffapp.mobile',
    '',
    'Everyone starts with a seven-day free trial. Thanks for waiting.',
    '',
    '---',
    'You are receiving this because you asked to be told when Riff launched.',
    'This is the only email we will send you.',
    'Unsubscribe: ' + unsubUrl,
    'Riff Apps Limited',
  ].join('\n');

  return { subject: 'Riff is live', html: html, text: text };
}


/** Password reset. Deliberately plain - this is a transactional email and
 *  anything that looks like marketing makes people distrust it. */
function resetEmail(link, alias) {
  var hi = alias ? ('Hello ' + alias + ',') : 'Hello,';
  var html = [
    '<div style="background:#0A0E18;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">',
    '  <div style="max-width:480px;margin:0 auto;background:#151B2B;border-radius:16px;padding:30px;">',
    '    <h1 style="margin:0 0 14px;font-size:20px;font-weight:700;color:#F0ECE5;">Reset your Riff password</h1>',
    '    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#CBD5E1;">' + hi + '</p>',
    '    <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#CBD5E1;">Someone asked to reset the password on this account. If that was you, use the button below. The link works once and expires in an hour.</p>',
    '    <a href="' + link + '" style="display:inline-block;background:#8B5CF6;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:12px;font-size:15px;font-weight:700;">Choose a new password</a>',
    '    <p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#8B8B96;">If it was not you, you can ignore this. Your password has not changed.</p>',
    '  </div>',
    '  <p style="max-width:480px;margin:18px auto 0;font-size:12px;color:#64748B;text-align:center;">Riff Apps Limited</p>',
    '</div>',
  ].join('\n');

  var text = [
    'Reset your Riff password', '',
    hi, '',
    'Someone asked to reset the password on this account. If that was you,',
    'open the link below. It works once and expires in an hour.', '',
    link, '',
    'If it was not you, you can ignore this. Your password has not changed.', '',
    'Riff Apps Limited',
  ].join('\n');

  return { subject: 'Reset your Riff password', html: html, text: text };
}

/** Sent at registration. Kept short - the only thing that matters is the
 *  button, and a long email buries it. */
function verifyEmail(link, alias) {
  var hi = alias ? ('Hello ' + alias + ',') : 'Hello,';
  var html = [
    '<div style="background:#0A0E18;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">',
    '  <div style="max-width:480px;margin:0 auto;background:#151B2B;border-radius:16px;padding:30px;">',
    '    <h1 style="margin:0 0 14px;font-size:20px;font-weight:700;color:#F0ECE5;">Confirm your email</h1>',
    '    <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#CBD5E1;">' + hi + '</p>',
    '    <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#CBD5E1;">Welcome to Riff. Confirm this address so we can match you with people, and so you can get back in if you ever forget your password.</p>',
    '    <a href="' + link + '" style="display:inline-block;background:#8B5CF6;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:12px;font-size:15px;font-weight:700;">Confirm my email</a>',
    '    <p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#8B8B96;">The link expires in 48 hours. If you did not sign up for Riff, you can ignore this.</p>',
    '  </div>',
    '  <p style="max-width:480px;margin:18px auto 0;font-size:12px;color:#64748B;text-align:center;">Riff Apps Limited</p>',
    '</div>',
  ].join('\n');

  var text = [
    'Confirm your email', '',
    hi, '',
    'Welcome to Riff. Confirm this address so we can match you with people,',
    'and so you can get back in if you ever forget your password.', '',
    link, '',
    'The link expires in 48 hours. If you did not sign up for Riff, ignore this.', '',
    'Riff Apps Limited',
  ].join('\n');

  return { subject: 'Confirm your Riff email', html: html, text: text };
}
module.exports = { sendEmail, launchEmail, resetEmail, verifyEmail, FROM };
