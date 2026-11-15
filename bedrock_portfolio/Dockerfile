FROM public.ecr.aws/lambda/python:3.13
COPY bedrock_portfolio/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt --target ${LAMBDA_TASK_ROOT}
COPY bedrock_portfolio/portfolio_skill.py ${LAMBDA_TASK_ROOT}/portfolio_skill.py
COPY alphaforge_starter/*.csv ${LAMBDA_TASK_ROOT}/alphaforge_starter/
CMD ["portfolio_skill.lambda_handler"]
