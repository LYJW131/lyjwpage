# 只依赖 Python 3 标准库，没有 pip 步骤，alpine 那份解释器就够。
FROM python:3.13-alpine
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY reporter.py ./
# 构建这份镜像的提交，上报时带上，站点卡片据此显示线上跑的是哪一版
ARG GIT_SHA=""
ENV REPORTER_COMMIT=$GIT_SHA
# /proc 和挂进来的宿主机 /etc 都是全局可读，不需要 root。
USER nobody
CMD ["python3", "-u", "reporter.py"]
