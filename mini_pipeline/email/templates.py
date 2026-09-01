"""HTML email templates with rich styling for verification codes and pipeline notifications."""

from __future__ import annotations

import html


def render_otp_email(
    code: str, purpose: str, expires_minutes: int = 5
) -> tuple[str, str, str]:
    """Return (subject, html_content, text_content) for verification codes."""
    purpose_map = {
        "register": ("账号注册", "欢迎注册 Mini Pipeline！您正在进行账号注册"),
        "login": ("快捷登录", "您正在使用邮箱验证码快捷登录 Mini Pipeline"),
        "reset_password": ("重置密码", "您正在申请重置 Mini Pipeline 登录密码"),
        "bind_email": ("绑定邮箱", "您正在为 Mini Pipeline 账号绑定此邮箱"),
        "test": ("测试验证码", "这是一封验证码发信测试邮件"),
    }
    title, desc = purpose_map.get(purpose, ("安全验证", "您正在进行安全身份验证"))
    subject = f"【Mini Pipeline】{title}验证码：{code}"

    text_content = (
        f"您好！\n\n"
        f"{desc}，您的验证码是：{code}\n\n"
        f"该验证码 {expires_minutes} 分钟内有效。请勿将验证码泄露给他人。\n"
        f"如果非您本人操作，请忽略此邮件。\n\n"
        f"— Mini Pipeline CI/CD 自动化系统"
    )

    font_stack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    html_content = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
        f"<body style=\"margin: 0; padding: 24px; font-family: {font_stack}; "
        "background-color: #f5f7fa; color: #333333;\">"
        "<table align='center' border='0' cellpadding='0' cellspacing='0' width='100%' "
        "style='max-width: 580px; background-color: #ffffff; border-radius: 12px; "
        "overflow: hidden; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.06);'>"
        "<tr><td style='padding: 28px 32px; background: linear-gradient(135deg, #1677ff 0%, "
        "#0958d9 100%); color: #ffffff; text-align: left;'>"
        "<h1 style='margin: 0; font-size: 22px; font-weight: 700;'>⚡ Mini Pipeline</h1>"
        "<p style='margin: 6px 0 0 0; font-size: 13px; opacity: 0.85;'>"
        "轻量、高性能的现代 CI/CD 自动化流水线平台</p></td></tr>"
        "<tr><td style='padding: 36px 32px 28px 32px;'>"
        f"<h2 style='margin: 0 0 16px 0; font-size: 18px; color: #1f1f1f;'>"
        f"{html.escape(title)}</h2>"
        f"<p style='margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #595959;'>"
        f"{html.escape(desc)}，请在页面中输入以下 6 位数字验证码完成验证：</p>"
        "<div style='background-color: #f0f7ff; border: 1px dashed #91caff; border-radius: 8px; "
        "padding: 20px 24px; text-align: center; margin-bottom: 24px;'>"
        "<span style='font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1677ff; "
        f"font-family: monospace;'>{code}</span></div>"
        f"<p style='margin: 0 0 8px 0; font-size: 13px; color: #8c8c8c;'>"
        f"⏱️ 验证码有效期为 <strong>{expires_minutes} 分钟</strong>。</p>"
        "<p style='margin: 0; font-size: 13px; color: #8c8c8c;'>"
        "🔒 如非您本人操作，请忽略此邮件，您的账号安全不会受到影响。</p>"
        "</td></tr>"
        "<tr><td style='padding: 20px 32px; background-color: #fafafa; "
        "border-top: 1px solid #f0f0f0; text-align: center; font-size: 12px; color: #bfbfbf;'>"
        "© 2026 Mini Pipeline CI/CD Platform · 本邮件为系统自动发出</td></tr>"
        "</table></body></html>"
    )
    return subject, html_content, text_content


def render_pipeline_notification_email(
    pipeline_name: str,
    run_id: str,
    status: str,
    duration_s: float,
    trigger_by: str = "系统",
    web_url: str = "",
    error_summary: str = "",
) -> tuple[str, str, str]:
    """Return (subject, html_content, text_content) for pipeline run notifications."""
    is_success = status.lower() == "success"
    if is_success:
        status_text = "执行成功 ✅"
        theme_color = "#52c41a"
    elif status.lower() == "failed":
        status_text = "执行失败 ❌"
        theme_color = "#ff4d4f"
    else:
        status_text = f"执行已中断 ({status})"
        theme_color = "#faad14"

    subject = f"【Mini Pipeline 通知】流水线「{pipeline_name}」{status_text}"

    text_content = (
        f"流水线执行通知\n"
        f"流水线名称: {pipeline_name}\n"
        f"运行 ID: {run_id}\n"
        f"执行状态: {status}\n"
        f"耗时: {duration_s:.2f}s\n"
        f"触发人: {trigger_by}\n"
        f"{f'错误摘要: {error_summary}' if error_summary else ''}\n"
        f"{f'查看详情: {web_url}' if web_url else ''}\n"
    )

    err_block = ""
    if error_summary:
        err_block = (
            "<div style='margin-top: 20px; padding: 14px 16px; background-color: #fff2f0; "
            "border-left: 4px solid #ff4d4f; border-radius: 4px; font-size: 13px; color: #cf1322;'>"
            f"<strong>错误摘要：</strong><br/>"
            f"<pre style='margin: 6px 0 0 0; white-space: pre-wrap; font-family: monospace; "
            f"font-size: 12px;'>{html.escape(error_summary)}</pre></div>"
        )

    link_block = ""
    if web_url:
        link_block = (
            "<div style='margin-top: 28px; text-align: center;'>"
            f"<a href='{web_url}' style='display: inline-block; padding: 10px 24px; "
            "background-color: #1677ff; color: #ffffff; text-decoration: none; "
            "border-radius: 6px; font-weight: 600; font-size: 14px;'>"
            "查看详细运行日志与产物 →</a></div>"
        )

    font_stack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    html_content = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
        f"<body style=\"margin: 0; padding: 24px; font-family: {font_stack}; "
        "background-color: #f5f7fa; color: #333333;\">"
        "<table align='center' border='0' cellpadding='0' cellspacing='0' width='100%' "
        "style='max-width: 600px; background-color: #ffffff; border-radius: 12px; "
        "overflow: hidden; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.06);'>"
        f"<tr><td style='padding: 24px 32px; background-color: {theme_color}; color: #ffffff;'>"
        "<h1 style='margin: 0; font-size: 20px; font-weight: 700;'>🚀 流水线构建运行报告</h1>"
        f"<p style='margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;'>"
        f"流水线「{html.escape(pipeline_name)}」{status_text}</p></td></tr>"
        "<tr><td style='padding: 28px 32px;'>"
        "<table width='100%' cellpadding='8' cellspacing='0' style='font-size: 14px; "
        "color: #595959; border-collapse: collapse;'>"
        f"<tr style='border-bottom: 1px solid #f0f0f0;'><td width='100' "
        "style='color: #8c8c8c; font-weight: 600;'>流水线名称</td>"
        f"<td style='color: #262626; font-weight: 600;'>{html.escape(pipeline_name)}</td></tr>"
        f"<tr style='border-bottom: 1px solid #f0f0f0;'><td style='color: #8c8c8c; "
        "font-weight: 600;'>运行状态</td>"
        f"<td><span style='display: inline-block; padding: 2px 8px; border-radius: 4px; "
        f"background-color: {theme_color}1a; color: {theme_color}; font-weight: 700;'>"
        f"{status}</span></td></tr>"
        f"<tr style='border-bottom: 1px solid #f0f0f0;'><td style='color: #8c8c8c; "
        f"font-weight: 600;'>执行耗时</td><td style='color: #262626;'>{duration_s:.2f} 秒</td></tr>"
        f"<tr style='border-bottom: 1px solid #f0f0f0;'><td style='color: #8c8c8c; "
        f"font-weight: 600;'>触发方式</td><td style='color: #262626;'>"
        f"{html.escape(trigger_by)}</td></tr>"
        f"<tr style='border-bottom: 1px solid #f0f0f0;'><td style='color: #8c8c8c; "
        f"font-weight: 600;'>运行 ID</td><td style='font-family: monospace; "
        f"color: #595959;'>{run_id}</td></tr>"
        f"</table>{err_block}{link_block}</td></tr>"
        "<tr><td style='padding: 16px 32px; background-color: #fafafa; "
        "border-top: 1px solid #f0f0f0; text-align: center; font-size: 12px; color: #bfbfbf;'>"
        "© Mini Pipeline CI/CD Platform · 自动化通知邮件</td></tr>"
        "</table></body></html>"
    )
    return subject, html_content, text_content


def render_test_email() -> tuple[str, str, str]:
    """Return (subject, html_content, text_content) for admin SMTP connectivity test."""
    subject = "【Mini Pipeline】SMTP 邮件服务连通性测试成功"
    text_content = (
        "恭喜！Mini Pipeline 邮件服务配置成功，SMTP 连通性测试通过。\n"
        "— Mini Pipeline CI/CD 自动化系统"
    )
    font_stack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    html_content = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
        f"<body style=\"margin: 0; padding: 24px; font-family: {font_stack}; "
        "background-color: #f5f7fa; color: #333333;\">"
        "<table align='center' border='0' cellpadding='0' cellspacing='0' width='100%' "
        "style='max-width: 540px; background-color: #ffffff; border-radius: 12px; "
        "overflow: hidden; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.06);'>"
        "<tr><td style='padding: 24px 32px; background-color: #52c41a; color: #ffffff;'>"
        "<h1 style='margin: 0; font-size: 20px; font-weight: 700;'>🎉 SMTP 邮件服务配置成功</h1>"
        "</td></tr><tr><td style='padding: 32px;'>"
        "<p style='margin: 0 0 16px 0; font-size: 15px; color: #262626; line-height: 1.6;'>"
        "您好！这是一封由 <strong>Mini Pipeline CI/CD</strong> 平台发出的测试邮件。</p>"
        "<p style='margin: 0 0 20px 0; font-size: 14px; color: #595959; line-height: 1.6;'>"
        "当您收到这封邮件时，说明 SMTP 服务器连接、认证及 SSL/TLS 通道均已配置正确！</p>"
        "<div style='padding: 12px 16px; background-color: #f6ffed; border: 1px solid #b7eb8f; "
        "border-radius: 6px; color: #389e0d; font-size: 13px;'>"
        "✅ 系统已具备：验证码注册登录、找回密码、流水线构建告警等完整发信能力。</div>"
        "</td></tr>"
        "<tr><td style='padding: 16px 32px; background-color: #fafafa; "
        "border-top: 1px solid #f0f0f0; text-align: center; font-size: 12px; color: #bfbfbf;'>"
        "© Mini Pipeline CI/CD Platform · 连通性测试</td></tr>"
        "</table></body></html>"
    )
    return subject, html_content, text_content


def render_welcome_email(
    username: str,
    email: str,
    display_name: str = "",
) -> tuple[str, str, str]:
    """Return (subject, html_content, text_content) for new user registration welcome."""
    user_title = display_name or username
    subject = "【Mini Pipeline】注册成功 - 欢迎开启现代自动化流水线之旅 🎉"
    text_content = (
        f"尊敬的 {user_title}，您好！\n\n"
        f"恭喜您成功注册 Mini Pipeline CI/CD 自动化流水线平台账号！\n\n"
        f"账号信息：\n"
        f"- 用户名：{username}\n"
        f"- 绑定邮箱：{email}\n\n"
        f"您现在可以登录平台探索：\n"
        f"• 可视化流水线编排与 DAG 依赖编排\n"
        f"• 零 SDK 插件生态与内容寻址高效缓存\n"
        f"• 多计算节点 Pull Agent / SSH 远程调度与执行\n"
        f"• 制品仓库与全功能 IDE 运维工作台\n\n"
        f"祝您使用愉快！\n"
        f"— Mini Pipeline 团队"
    )
    font_stack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    html_content = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
        f"<body style=\"margin: 0; padding: 24px; font-family: {font_stack}; "
        "background-color: #f5f7fa; color: #333333;\">"
        "<table align='center' border='0' cellpadding='0' cellspacing='0' width='100%' "
        "style='max-width: 580px; background-color: #ffffff; border-radius: 12px; "
        "overflow: hidden; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.06);'>"
        "<tr><td style='padding: 28px 32px; background: linear-gradient(135deg, #1677ff 0%, "
        "#0958d9 100%); color: #ffffff; text-align: left;'>"
        "<h1 style='margin: 0; font-size: 22px; font-weight: 700;'>🎉 欢迎加入 Mini Pipeline</h1>"
        "<p style='margin: 6px 0 0 0; font-size: 13px; opacity: 0.85;'>"
        "轻量、高性能的现代 CI/CD 自动化流水线平台</p></td></tr>"
        "<tr><td style='padding: 32px;'>"
        f"<h2 style='margin: 0 0 16px 0; font-size: 18px; color: #1f1f1f;'>"
        f"尊敬的 {html.escape(user_title)}，您好！</h2>"
        "<p style='margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #595959;'>"
        "恭喜您成功创建 <strong>Mini Pipeline</strong> 账号！"
        "平台现已为您准备就绪，开启高效流水线编排体验。</p>"
        "<div style='background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; "
        "padding: 18px 20px; margin-bottom: 24px; font-size: 13px; color: #475569;'>"
        f"<div style='margin-bottom: 8px;'><strong>👤 用户名：</strong>"
        f"{html.escape(username)}</div>"
        f"<div><strong>✉️ 绑定邮箱：</strong>{html.escape(email)}</div>"
        "</div>"
        "<div style='margin-bottom: 24px; font-size: 13px; line-height: 1.8; color: #595959;'>"
        "<p style='margin: 0 0 8px 0; font-weight: 600; color: #1f1f1f;'>"
        "🚀 您可以立即体验以下核心功能：</p>"
        "<div>⚡ <strong>DAG 可视化编排</strong>：节点自由连线与多步骤依赖调度</div>"
        "<div>🧩 <strong>零 SDK 插件机制</strong>：支持 Shell/Python/Node 及 Docker 运行时</div>"
        "<div>💾 <strong>内容寻址步骤缓存</strong>：秒级跳过无变化步骤，极大缩短构建耗时</div>"
        "<div>💻 <strong>多节点分布式执行</strong>：Pull Agent 轮询与 SSH 免代理推送调度</div>"
        "</div>"
        "</td></tr>"
        "<tr><td style='padding: 20px 32px; background-color: #fafafa; "
        "border-top: 1px solid #f0f0f0; text-align: center; font-size: 12px; color: #bfbfbf;'>"
        "© 2026 Mini Pipeline CI/CD Platform · 欢迎邮件</td></tr>"
        "</table></body></html>"
    )
    return subject, html_content, text_content
