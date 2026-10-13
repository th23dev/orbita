export function authErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : ''
  if (code === 'over_email_send_rate_limit' || /email rate limit exceeded/i.test(message)) {
    return 'O limite de envio de e-mails da Órbita foi atingido. Aguarde e tente novamente mais tarde. Se continuar acontecendo, avise o administrador para ajustar o serviço de e-mail.'
  }
  if (code === 'over_request_rate_limit' || /too many requests|request rate limit/i.test(message)) {
    return 'Foram feitas muitas tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.'
  }
  if (code === 'email_address_not_authorized' || /email address not authorized/i.test(message)) {
    return 'O serviço de e-mail ainda não está habilitado para esse endereço. Avise o administrador para concluir a configuração.'
  }
  return message || 'Não foi possível concluir. Tente novamente.'
}
