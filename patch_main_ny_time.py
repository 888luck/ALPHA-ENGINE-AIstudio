import re

with open('main.py', 'r') as f:
    content = f.read()

new_func = """import zoneinfo

def get_current_ny_time():
    \"\"\"Returns actual US Eastern Time intraday timestamp simulation.\"\"\"
    now = datetime.datetime.now(zoneinfo.ZoneInfo("America/New_York"))
    return now.strftime("%H:%M")"""

# Find def get_current_ny_time():
start = content.find("def get_current_ny_time():")
# Find the end of it (next def is main_loop)
end = content.find("def main_loop():")

new_content = content[:start] + new_func + "\n\n" + content[end:]

with open('main.py', 'w') as f:
    f.write(new_content)
